"""dependency records

Adds the dependency_records table (the declared dependencies of a full-analysis run, with
their latest versions and known vulnerabilities) and the nullable analysis_runs.dependencies
column (the run's dependency summary; NULL for runs stored before dependency analysis).

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ECOSYSTEM_VALID = "ecosystem IN ('npm', 'python')"
SOURCE_VALID = "version_source IN ('pinned', 'minimum', 'none')"
UPDATE_VALID = "update IN ('up_to_date', 'patch', 'minor', 'major', 'unknown')"
SEVERITY_VALID = (
    "max_severity IS NULL OR max_severity IN ('critical', 'high', 'medium', 'low', 'unknown')"
)
COUNT_VALID = "vulnerability_count >= 0"


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("dependencies", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "dependency_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("manifest", sa.Text(), nullable=False),
        sa.Column("ecosystem", sa.String(length=8), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("specifier", sa.Text(), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("line", sa.Integer(), nullable=True),
        sa.Column("version", sa.String(length=100), nullable=True),
        sa.Column("version_source", sa.String(length=8), nullable=False),
        sa.Column("latest_version", sa.String(length=100), nullable=True),
        sa.Column("update", sa.String(length=16), nullable=False),
        sa.Column("vulnerability_count", sa.Integer(), nullable=False),
        sa.Column("max_severity", sa.String(length=8), nullable=True),
        sa.Column("vulnerabilities", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("conflict", sa.Boolean(), nullable=False),
        sa.CheckConstraint(ECOSYSTEM_VALID, name=op.f("ck_dependency_records_ecosystem_valid")),
        sa.CheckConstraint(SOURCE_VALID, name=op.f("ck_dependency_records_source_valid")),
        sa.CheckConstraint(UPDATE_VALID, name=op.f("ck_dependency_records_update_valid")),
        sa.CheckConstraint(SEVERITY_VALID, name=op.f("ck_dependency_records_severity_valid")),
        sa.CheckConstraint(COUNT_VALID, name=op.f("ck_dependency_records_count_valid")),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_dependency_records_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_dependency_records")),
    )
    op.create_index("ix_dependency_records_run_id_name", "dependency_records", ["run_id", "name"])
    op.create_index(
        "ix_dependency_records_run_id_vulnerability_count",
        "dependency_records",
        ["run_id", "vulnerability_count"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_dependency_records_run_id_vulnerability_count", table_name="dependency_records"
    )
    op.drop_index("ix_dependency_records_run_id_name", table_name="dependency_records")
    op.drop_table("dependency_records")
    op.drop_column("analysis_runs", "dependencies")
