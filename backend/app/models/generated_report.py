import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class GeneratedReport(UUIDPrimaryKeyMixin, Base):
    """A PDF report of one analysis run (Module 10), kept for its user to download again.

    The PDF is stored in the database (hosted disks are wiped on redeploys), with its size
    and SHA-256 so a download can be checked. The content column is loaded only when a
    report is downloaded."""

    __tablename__ = "generated_reports"
    __table_args__ = (
        Index("ix_generated_reports_user_id_created_at", "user_id", "created_at"),
        Index("ix_generated_reports_run_id", "run_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    repository_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    pages: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
