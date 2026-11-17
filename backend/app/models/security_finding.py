import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.analysis.security.rules import CONFIDENCES, OWASP_KEYS, SEVERITIES
from app.models.base import Base, UUIDPrimaryKeyMixin


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class SecurityFinding(UUIDPrimaryKeyMixin, Base):
    """One security finding of a full-analysis run (Module 4).

    Files are identified by path, like every run result. Matched secret values are never
    stored: messages describe what was found, not its content. Written in the transaction
    that stores the run; never updated.
    """

    __tablename__ = "security_findings"
    __table_args__ = (
        CheckConstraint(_in("severity", SEVERITIES), name="severity_valid"),
        CheckConstraint(_in("confidence", CONFIDENCES), name="confidence_valid"),
        CheckConstraint(_in("owasp", OWASP_KEYS), name="owasp_valid"),
        CheckConstraint("line >= 1 AND end_line >= line", name="lines_valid"),
        Index("ix_security_findings_run_id_severity", "run_id", "severity"),
        Index("ix_security_findings_run_id_owasp", "run_id", "owasp"),
        Index("ix_security_findings_run_id_path", "run_id", "path"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    path: Mapped[str] = mapped_column(Text, nullable=False)
    line: Mapped[int] = mapped_column(Integer, nullable=False)
    end_line: Mapped[int] = mapped_column(Integer, nullable=False)
    tool: Mapped[str] = mapped_column(String(32), nullable=False)
    rule_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    owasp: Mapped[str] = mapped_column(String(3), nullable=False)
    cwe: Mapped[int | None] = mapped_column(Integer, nullable=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    confidence: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    recommendation: Mapped[str] = mapped_column(Text, nullable=False)
    doc_url: Mapped[str | None] = mapped_column(Text, nullable=True)
