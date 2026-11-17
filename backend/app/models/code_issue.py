import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.analysis.quality.rules import CATEGORIES, SEVERITIES
from app.models.base import Base, UUIDPrimaryKeyMixin

SEVERITY_VALUES = SEVERITIES
CATEGORY_VALUES = CATEGORIES


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class CodeIssue(UUIDPrimaryKeyMixin, Base):
    """One code-quality finding of a full-analysis run (Module 3).

    Files are identified by path, like every run result, so the history of a run never
    changes when the repository is re-ingested. Written in the transaction that stores the
    run; never updated.
    """

    __tablename__ = "code_issues"
    __table_args__ = (
        CheckConstraint(_in("severity", SEVERITY_VALUES), name="severity_valid"),
        CheckConstraint(_in("category", CATEGORY_VALUES), name="category_valid"),
        CheckConstraint("line >= 1 AND end_line >= line", name="lines_valid"),
        Index("ix_code_issues_run_id_severity", "run_id", "severity"),
        Index("ix_code_issues_run_id_category", "run_id", "category"),
        Index("ix_code_issues_run_id_path", "run_id", "path"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    column: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    tool: Mapped[str] = mapped_column(String(32), nullable=False)
    rule_id: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    suggestion: Mapped[str] = mapped_column(Text, nullable=False)
    doc_url: Mapped[str | None] = mapped_column(Text, nullable=True)
