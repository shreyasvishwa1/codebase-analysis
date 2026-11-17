import uuid
from typing import Any

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDPrimaryKeyMixin


class ArchitectureReport(UUIDPrimaryKeyMixin, Base):
    """The architecture of a full-analysis run's snapshot (Module 7): components, edges,
    technologies, data stores, routes, entry points, infrastructure and observations, each
    with evidence. One per run (the run's summary counts are in analysis_runs.architecture);
    written with the run, never updated. Bounded by the analyzer's limits."""

    __tablename__ = "architecture_reports"

    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_runs.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    document: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
