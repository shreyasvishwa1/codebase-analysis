"""Progress of a full analysis, as the job's 0-100 percentage.

The analysis has no separate progress field: each stage owns a range of the percentage,
so the client can name the stage from the number alone. Keep these in step with the
frontend (src/utils/analysisStages.ts).
"""

import asyncio
import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnalysisJob, AnalysisJobStatus

STARTED = 3  # claimed by a worker
READING_START = 5  # files read and fed to every analyzer, one at a time
READING_END = 60
TOOLS = 62  # Ruff, Bandit and the analyzers' final passes
DEPENDENCIES = 76  # OSV.dev lookups for the declared dependencies
SAVING = 92  # results written to the database
# 100 is set together with the completed status.

REPORT_EVERY_SECONDS = 0.75


def reading_progress(done: int, total: int) -> int:
    """The percentage while files are read: READING_START with none, READING_END with all."""
    if total <= 0:
        return READING_END
    share = min(1.0, max(0.0, done / total))
    return READING_START + int((READING_END - READING_START) * share)


class ProgressTracker:
    """The latest percentage, set from the analysis thread and read by the reporter.

    A plain int assignment is atomic in Python, so no lock is needed; the value only grows."""

    def __init__(self, start: int = STARTED) -> None:
        self.value = start

    def set(self, value: int) -> None:
        if value > self.value:
            self.value = min(99, value)


async def set_job_progress(db: AsyncSession, job_id: uuid.UUID, value: int) -> None:
    """Raise a processing job's progress to value (never lowers it, never touches a job
    that finished or was recovered meanwhile) and commit."""
    await db.execute(
        update(AnalysisJob)
        .where(
            AnalysisJob.id == job_id,
            AnalysisJob.status == AnalysisJobStatus.PROCESSING,
            AnalysisJob.progress < value,
        )
        .values(progress=value)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def report_progress(
    db: AsyncSession,
    job_id: uuid.UUID,
    tracker: ProgressTracker,
    stop: asyncio.Event,
    interval: float = REPORT_EVERY_SECONDS,
) -> None:
    """Write the tracker's value to the job about once per interval until stop is set.

    Best effort: the job's progress is only a display, so a failed write ends the
    reporting without failing the analysis. The caller sets stop and awaits this task
    before it uses the session again, so the session is never used twice at once."""
    written = -1
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
            return
        except TimeoutError:
            pass
        value = tracker.value
        if value == written:
            continue
        try:
            await set_job_progress(db, job_id, value)
            written = value
        except Exception:
            await db.rollback()
            return
