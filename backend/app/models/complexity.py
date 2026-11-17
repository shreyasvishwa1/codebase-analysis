import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin

RANK_VALID = "rank IN ('low', 'medium', 'high')"


class ComplexityFile(UUIDPrimaryKeyMixin, Base):
    """Complexity metrics of one source file in a full-analysis run (Module 5).

    ``rank`` is the rank of the file's most complex function. ``maintainability_index`` is
    0-100 (NULL for a file without code); ``mi_estimated`` is true when it was computed from
    Lizard's tokens rather than by Radon. Written with the run; never updated.
    """

    __tablename__ = "complexity_files"
    __table_args__ = (
        CheckConstraint(RANK_VALID, name="rank_valid"),
        CheckConstraint(
            "maintainability IS NULL OR maintainability IN ('good', 'moderate', 'poor')",
            name="maintainability_valid",
        ),
        CheckConstraint(
            "nloc >= 0 AND functions >= 0 AND classes >= 0 AND total_cyclomatic >= 0"
            " AND max_cyclomatic >= 0",
            name="counts_valid",
        ),
        UniqueConstraint("run_id", "path"),
        Index("ix_complexity_files_run_id_max_cyclomatic", "run_id", "max_cyclomatic"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(32), nullable=False)
    nloc: Mapped[int] = mapped_column(Integer, nullable=False)
    functions: Mapped[int] = mapped_column(Integer, nullable=False)
    classes: Mapped[int] = mapped_column(Integer, nullable=False)
    total_cyclomatic: Mapped[int] = mapped_column(Integer, nullable=False)
    max_cyclomatic: Mapped[int] = mapped_column(Integer, nullable=False)
    average_cyclomatic: Mapped[float] = mapped_column(Float, nullable=False)
    rank: Mapped[str] = mapped_column(String(8), nullable=False)
    maintainability_index: Mapped[float | None] = mapped_column(Float, nullable=True)
    maintainability: Mapped[str | None] = mapped_column(String(16), nullable=True)
    mi_estimated: Mapped[bool] = mapped_column(Boolean, nullable=False)


class ComplexityFunction(UUIDPrimaryKeyMixin, Base):
    """One function's complexity in a full-analysis run (the most complex are stored)."""

    __tablename__ = "complexity_functions"
    __table_args__ = (
        CheckConstraint(RANK_VALID, name="rank_valid"),
        CheckConstraint("line >= 1 AND end_line >= line", name="lines_valid"),
        CheckConstraint("cyclomatic >= 1 AND nloc >= 0 AND parameters >= 0", name="counts_valid"),
        Index("ix_complexity_functions_run_id_cyclomatic", "run_id", "cyclomatic"),
        Index("ix_complexity_functions_run_id_path", "run_id", "path"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    cyclomatic: Mapped[int] = mapped_column(Integer, nullable=False)
    nloc: Mapped[int] = mapped_column(Integer, nullable=False)
    parameters: Mapped[int] = mapped_column(Integer, nullable=False)
    rank: Mapped[str] = mapped_column(String(8), nullable=False)
