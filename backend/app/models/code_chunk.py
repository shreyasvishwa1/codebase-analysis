import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class CodeChunk(UUIDPrimaryKeyMixin, Base):
    """One retrieval unit of a full-analysis run for the AI chat (Module 9): a Python
    definition or a window of lines, with secrets masked (app.analysis.chunks). ``search`` is
    the full-text vector of its path and symbol (weight A) and body (weight D). Written with
    the run, never updated."""

    __tablename__ = "code_chunks"
    __table_args__ = (
        CheckConstraint("start_line >= 1 AND end_line >= start_line", name="lines_valid"),
        Index("ix_code_chunks_run_id_path", "run_id", "path"),
        Index("ix_code_chunks_search", "search", postgresql_using="gin"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    symbol: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    search: Mapped[str] = mapped_column(TSVECTOR, nullable=False)
