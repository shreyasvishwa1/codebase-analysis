"""Full-analysis runs: start, execute and list.

API side: ``start_full_analysis`` records a pending ``full_analysis`` job for a ready
repository (after recovering a stale one) and queues it. ``list_runs`` and ``get_run``
return the repository's run history and the latest job.

Worker side: ``run_full_analysis_job`` claims the job (pending -> processing), captures the
snapshot, runs the analyzers in a worker thread and stores the run. The snapshot check is
the one used by the code-metrics analysis: before storing, the current files rows are locked
FOR KEY SHARE NOWAIT and compared with the captured snapshot, so a run is only ever recorded
for the snapshot it analyzed. A run row is written in the same transaction that completes
its job, so every run has complete results.
"""

import tempfile
import uuid
from dataclasses import asdict, dataclass
from datetime import timedelta
from pathlib import Path

from sqlalchemy import and_, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.analysis.quality.analyzer import QualityAnalyzer, QualityResult
from app.analysis.snapshot import SnapshotRow, iter_snapshot
from app.analysis.summary import Summary, SummaryBuilder
from app.config import get_settings
from app.models import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    AnalysisRun,
    CodeIssue,
    File,
    Repository,
    RepositoryStatus,
)
from app.services.analysis_jobs import claim_pending_job, fail_pending_job

# The snapshot lock shared with the code-metrics analysis, reused unchanged.
from app.services.code_metrics import _lock_current_snapshot
from app.services.ingestion import repository_storage_dir
from app.workers import queue

PROCESSING_STALE_AFTER = timedelta(seconds=1800 + 300)  # worker job timeout plus grace
PENDING_STALE_AFTER = timedelta(hours=6)
HISTORY_LIMIT = 50

NOT_READY = "Repository must be ingested before analysis"
INGESTION_IN_PROGRESS = "Repository ingestion is in progress"
ALREADY_RUNNING = "A full analysis is already in progress"
QUEUE_FAILURE_MESSAGE = "Analysis could not be queued; try again later"
INVALID_JOB_MESSAGE = "Invalid analysis job"
CHANGED_MESSAGE = "Repository changed during analysis; run it again"
INTERNAL_FAILURE_MESSAGE = "Analysis failed due to an internal error"
STALE_PROCESSING_MESSAGE = "Analysis was interrupted; please run it again"
STALE_PENDING_MESSAGE = "Analysis was not started; please run it again"
RUN_NOT_FOUND = "Analysis run not found"

_ACTIVE = (AnalysisJobStatus.PENDING, AnalysisJobStatus.PROCESSING)


class AnalysisRunError(Exception):
    """A controlled failure, safe to return to the client."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# --- Analysis (runs in a worker thread) -------------------------------------------------------


@dataclass(frozen=True)
class RunResult:
    summary: Summary
    quality: QualityResult


def analyze_snapshot(root: Path, rows: list[SnapshotRow]) -> RunResult:
    """Run every analyzer over the snapshot in one pass, reading one file at a time.

    The quality analyzer's private working copy (verified Python files for Ruff) lives in a
    temporary directory that is removed when the analysis ends, whatever the outcome."""
    summary = SummaryBuilder()
    with tempfile.TemporaryDirectory(prefix="cba-analysis-") as workdir:
        quality = QualityAnalyzer(Path(workdir))
        for file in iter_snapshot(root, rows):
            summary.add(file)
            quality.add(file)
        return RunResult(summary.result(), quality.result())


# --- API side ---------------------------------------------------------------------------------


async def recover_stale_full_analysis_jobs(db: AsyncSession, repository_id: uuid.UUID) -> int:
    """Fail this repository's stale active full-analysis jobs and commit. Conditional, so a
    job claimed, finished or cancelled meanwhile is never overwritten."""
    now = func.now()
    processing = await db.execute(
        update(AnalysisJob)
        .where(
            AnalysisJob.repository_id == repository_id,
            AnalysisJob.job_type == AnalysisJobType.FULL_ANALYSIS,
            AnalysisJob.status == AnalysisJobStatus.PROCESSING,
            or_(
                AnalysisJob.started_at < now - PROCESSING_STALE_AFTER,
                and_(
                    AnalysisJob.started_at.is_(None),
                    AnalysisJob.created_at < now - PROCESSING_STALE_AFTER,
                ),
            ),
        )
        .values(
            status=AnalysisJobStatus.FAILED,
            error_message=STALE_PROCESSING_MESSAGE,
            completed_at=now,
        )
        .returning(AnalysisJob.id)
        .execution_options(synchronize_session=False)
    )
    pending = await db.execute(
        update(AnalysisJob)
        .where(
            AnalysisJob.repository_id == repository_id,
            AnalysisJob.job_type == AnalysisJobType.FULL_ANALYSIS,
            AnalysisJob.status == AnalysisJobStatus.PENDING,
            AnalysisJob.created_at < now - PENDING_STALE_AFTER,
        )
        .values(
            status=AnalysisJobStatus.FAILED, error_message=STALE_PENDING_MESSAGE, completed_at=now
        )
        .returning(AnalysisJob.id)
        .execution_options(synchronize_session=False)
    )
    recovered = len(processing.all()) + len(pending.all())
    await db.commit()
    return recovered


async def start_full_analysis(db: AsyncSession, repository: Repository) -> uuid.UUID:
    """Create and queue a full-analysis job for an authorized repository; return its id."""
    repository_id, project_id = repository.id, repository.project_id
    if repository.status == RepositoryStatus.PROCESSING:
        raise AnalysisRunError(409, INGESTION_IN_PROGRESS)
    if repository.status != RepositoryStatus.READY:
        raise AnalysisRunError(409, NOT_READY)
    active_ingestion = await db.scalar(
        select(AnalysisJob.id)
        .where(
            AnalysisJob.repository_id == repository_id,
            AnalysisJob.job_type == AnalysisJobType.INGESTION,
            AnalysisJob.status.in_(_ACTIVE),
        )
        .limit(1)
    )
    if active_ingestion is not None:
        raise AnalysisRunError(409, INGESTION_IN_PROGRESS)

    await recover_stale_full_analysis_jobs(db, repository_id)
    job = AnalysisJob(
        project_id=project_id,
        repository_id=repository_id,
        job_type=AnalysisJobType.FULL_ANALYSIS,
        status=AnalysisJobStatus.PENDING,
        progress=0,
    )
    db.add(job)
    try:
        await db.commit()
    except IntegrityError:  # another active full analysis (partial unique index)
        await db.rollback()
        raise AnalysisRunError(409, ALREADY_RUNNING) from None
    job_id = job.id

    try:
        await queue.enqueue_full_analysis_job(job_id)
    except Exception:
        await db.rollback()
        if await fail_pending_job(db, job_id, QUEUE_FAILURE_MESSAGE):
            await db.commit()
        raise AnalysisRunError(503, QUEUE_FAILURE_MESSAGE) from None
    return job_id


async def latest_job(db: AsyncSession, repository_id: uuid.UUID) -> AnalysisJob | None:
    return await db.scalar(
        select(AnalysisJob)
        .where(
            AnalysisJob.repository_id == repository_id,
            AnalysisJob.job_type == AnalysisJobType.FULL_ANALYSIS,
        )
        .order_by(AnalysisJob.created_at.desc(), AnalysisJob.id.desc())
        .limit(1)
        .execution_options(populate_existing=True)
    )


async def list_runs(db: AsyncSession, repository_id: uuid.UUID) -> list[AnalysisRun]:
    """The repository's completed runs, newest first (at most HISTORY_LIMIT)."""
    result = await db.scalars(
        select(AnalysisRun)
        .where(AnalysisRun.repository_id == repository_id)
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return list(result.all())


async def get_run(db: AsyncSession, repository_id: uuid.UUID, run_id: uuid.UUID) -> AnalysisRun:
    run = await db.scalar(
        select(AnalysisRun).where(
            AnalysisRun.id == run_id, AnalysisRun.repository_id == repository_id
        )
    )
    if run is None:  # missing, or another repository's run: the same answer
        raise AnalysisRunError(404, RUN_NOT_FOUND)
    return run


# --- Worker side ------------------------------------------------------------------------------


async def _fail_processing(db: AsyncSession, job_id: uuid.UUID, message: str) -> None:
    """Fail the job only if it is still processing (never overwrites a recovered job)."""
    await db.execute(
        update(AnalysisJob)
        .where(AnalysisJob.id == job_id, AnalysisJob.status == AnalysisJobStatus.PROCESSING)
        .values(status=AnalysisJobStatus.FAILED, error_message=message, completed_at=func.now())
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def _store_run(
    db: AsyncSession,
    job: AnalysisJob,
    repository: Repository,
    snapshot: set[uuid.UUID],
    result: RunResult,
) -> str:
    current = await _lock_current_snapshot(db, repository.id)
    if current != snapshot:
        await db.rollback()
        await _fail_processing(db, job.id, CHANGED_MESSAGE)
        return "failed"
    completed = await db.execute(
        update(AnalysisJob)
        .where(AnalysisJob.id == job.id, AnalysisJob.status == AnalysisJobStatus.PROCESSING)
        .values(status=AnalysisJobStatus.COMPLETED, progress=100, completed_at=func.now())
        .returning(AnalysisJob.id)
        .execution_options(synchronize_session=False)
    )
    if completed.scalar_one_or_none() is None:  # recovered as stale or cancelled meanwhile
        await db.rollback()
        return "skipped"
    summary = result.summary
    run = AnalysisRun(
        analysis_job_id=job.id,
        repository_id=repository.id,
        project_id=repository.project_id,
        file_count=summary.file_count,
        analyzed_file_count=summary.analyzed_file_count,
        excluded_file_count=summary.excluded_file_count,
        total_bytes=summary.total_bytes,
        total_lines=summary.total_lines,
        code_lines=summary.code_lines,
        languages=summary.languages,
        skipped=summary.skipped,
        quality=result.quality.summary,
        # The wall-clock time, not the transaction start: history order stays exact
        # even for runs stored within one transaction.
        created_at=func.clock_timestamp(),
    )
    db.add(run)
    await db.flush()
    if result.quality.issues:
        await db.execute(
            insert(CodeIssue),
            [{"run_id": run.id, **asdict(issue)} for issue in result.quality.issues],
        )
    await db.commit()
    return "completed"


async def run_full_analysis_job(db: AsyncSession, job_id: uuid.UUID) -> str:
    """Execute one queued full-analysis job and return its outcome. Failures are recorded
    on the job and never raised. Jobs of other types are never touched."""
    job = await db.get(AnalysisJob, job_id)
    if job is None:
        return "missing"
    if job.job_type != AnalysisJobType.FULL_ANALYSIS:
        return "invalid"
    repository = await db.scalar(
        select(Repository).where(
            Repository.id == job.repository_id, Repository.project_id == job.project_id
        )
    )
    if repository is None:
        await fail_pending_job(db, job_id, INVALID_JOB_MESSAGE)
        await db.commit()
        return "invalid"

    if not await claim_pending_job(db, job_id):
        await db.rollback()  # claimed elsewhere, finished, cancelled or recovered
        return "skipped"
    await db.commit()

    try:
        rows = (
            await db.execute(
                select(File.id, File.path, File.language, File.size_bytes, File.sha256).where(
                    File.repository_id == repository.id
                )
            )
        ).all()
        await db.commit()  # no transaction is held while files are read
        snapshot_rows = [SnapshotRow(r.path, r.language, r.size_bytes, r.sha256) for r in rows]
        root = repository_storage_dir(get_settings(), repository.id)
        result = await run_in_threadpool(analyze_snapshot, root, snapshot_rows)
        return await _store_run(db, job, repository, {r.id for r in rows}, result)
    except Exception:
        await db.rollback()
        await _fail_processing(db, job_id, INTERNAL_FAILURE_MESSAGE)
        return "failed"
