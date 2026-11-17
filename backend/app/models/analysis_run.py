import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.analysis_job import AnalysisJob
from app.models.base import Base, UUIDPrimaryKeyMixin


class AnalysisRun(UUIDPrimaryKeyMixin, Base):
    """One completed full analysis of a repository snapshot.

    Created in the same transaction that completes its ``full_analysis`` job, so a run
    always has complete results. Results of later phases reference the run and identify
    files by path (not by files row), so re-ingesting the repository never changes or
    removes the history of earlier runs.
    """

    __tablename__ = "analysis_runs"
    __table_args__ = (
        CheckConstraint(
            "file_count >= 0 AND analyzed_file_count >= 0 AND excluded_file_count >= 0"
            " AND analyzed_file_count + excluded_file_count <= file_count",
            name="file_counts_valid",
        ),
        CheckConstraint(
            "total_bytes >= 0 AND total_lines >= 0 AND code_lines BETWEEN 0 AND total_lines",
            name="totals_valid",
        ),
        # Repository history, newest first.
        Index("ix_analysis_runs_repository_id_created_at", "repository_id", "created_at"),
    )

    analysis_job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    analyzed_file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    excluded_file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    total_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_lines: Mapped[int] = mapped_column(Integer, nullable=False)
    code_lines: Mapped[int] = mapped_column(Integer, nullable=False)
    # [{"language", "files", "lines", "code_lines", "bytes"}], most lines first.
    languages: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    # {"binary", "too_large", "unavailable", "generated"}: files skipped while reading.
    skipped: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# At most one active full-analysis job per repository; created by migration 0004.
Index(
    "uq_analysis_jobs_active_full_analysis",
    AnalysisJob.repository_id,
    unique=True,
    postgresql_where=text("job_type = 'full_analysis' AND status IN ('pending', 'processing')"),
)
