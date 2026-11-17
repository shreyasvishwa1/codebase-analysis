import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class DependencyRecord(UUIDPrimaryKeyMixin, Base):
    """One declared dependency of a full-analysis run (Module 6).

    ``version`` is the version that was checked (pinned, or the lowest a range allows; NULL
    when the declaration has none). ``latest_version`` and ``vulnerabilities`` come from PyPI,
    npm and OSV.dev at analysis time (empty when lookups were disabled or failed).
    ``vulnerabilities`` is a list of {id, aliases, summary, severity, score, fixed_in, cwe, url}.
    Written with the run; never updated.
    """

    __tablename__ = "dependency_records"
    __table_args__ = (
        CheckConstraint("ecosystem IN ('npm', 'python')", name="ecosystem_valid"),
        CheckConstraint("version_source IN ('pinned', 'minimum', 'none')", name="source_valid"),
        CheckConstraint(
            "update IN ('up_to_date', 'patch', 'minor', 'major', 'unknown')", name="update_valid"
        ),
        CheckConstraint(
            "max_severity IS NULL OR max_severity IN ('critical', 'high', 'medium', 'low',"
            " 'unknown')",
            name="severity_valid",
        ),
        CheckConstraint("vulnerability_count >= 0", name="count_valid"),
        Index("ix_dependency_records_run_id_name", "run_id", "name"),
        Index("ix_dependency_records_run_id_vulnerability_count", "run_id", "vulnerability_count"),
    )

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), nullable=False
    )
    manifest: Mapped[str] = mapped_column(Text, nullable=False)
    ecosystem: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    specifier: Mapped[str] = mapped_column(Text, nullable=False)
    scope: Mapped[str] = mapped_column(String(64), nullable=False)
    line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    version_source: Mapped[str] = mapped_column(String(8), nullable=False)
    latest_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    update: Mapped[str] = mapped_column(String(16), nullable=False)
    vulnerability_count: Mapped[int] = mapped_column(Integer, nullable=False)
    max_severity: Mapped[str | None] = mapped_column(String(8), nullable=True)
    vulnerabilities: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    conflict: Mapped[bool] = mapped_column(Boolean, nullable=False)
