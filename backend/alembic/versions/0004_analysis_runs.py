"""analysis runs

Adds the 'full_analysis' analysis job type, the analysis_runs table (one row per completed
full analysis, with the run's summary) and a partial unique index allowing one active
full-analysis job per repository.

Downgrade removes full-analysis jobs (their runs cascade) and rebuilds analysis_job_type
without the new value (PostgreSQL cannot drop an enum value); the partial indexes that
depend on the column are re-created with their exact definitions.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE_INGESTION = "job_type = 'ingestion' AND status IN ('pending', 'processing')"
ACTIVE_CODE_METRICS = "job_type = 'code_metrics' AND status IN ('pending', 'processing')"
ACTIVE_FULL_ANALYSIS = "job_type = 'full_analysis' AND status IN ('pending', 'processing')"
FILE_COUNTS_VALID = (
    "file_count >= 0 AND analyzed_file_count >= 0 AND excluded_file_count >= 0"
    " AND analyzed_file_count + excluded_file_count <= file_count"
)
TOTALS_VALID = "total_bytes >= 0 AND total_lines >= 0 AND code_lines BETWEEN 0 AND total_lines"


def upgrade() -> None:
    # A new enum value must be committed before the partial index below can compare with it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE analysis_job_type ADD VALUE IF NOT EXISTS 'full_analysis'")

    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("analysis_job_id", sa.Uuid(), nullable=False),
        sa.Column("repository_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("file_count", sa.Integer(), nullable=False),
        sa.Column("analyzed_file_count", sa.Integer(), nullable=False),
        sa.Column("excluded_file_count", sa.Integer(), nullable=False),
        sa.Column("total_bytes", sa.BigInteger(), nullable=False),
        sa.Column("total_lines", sa.Integer(), nullable=False),
        sa.Column("code_lines", sa.Integer(), nullable=False),
        sa.Column("languages", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("skipped", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(FILE_COUNTS_VALID, name=op.f("ck_analysis_runs_file_counts_valid")),
        sa.CheckConstraint(TOTALS_VALID, name=op.f("ck_analysis_runs_totals_valid")),
        sa.ForeignKeyConstraint(
            ["analysis_job_id"],
            ["analysis_jobs.id"],
            name=op.f("fk_analysis_runs_analysis_job_id_analysis_jobs"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repository_id"],
            ["repositories.id"],
            name=op.f("fk_analysis_runs_repository_id_repositories"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_analysis_runs_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_analysis_runs")),
        sa.UniqueConstraint("analysis_job_id", name=op.f("uq_analysis_runs_analysis_job_id")),
    )
    op.create_index(
        "ix_analysis_runs_repository_id_created_at",
        "analysis_runs",
        ["repository_id", "created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_analysis_runs_project_id"), "analysis_runs", ["project_id"], unique=False
    )
    op.create_index(
        "uq_analysis_jobs_active_full_analysis",
        "analysis_jobs",
        ["repository_id"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_FULL_ANALYSIS),
    )


def downgrade() -> None:
    op.drop_index("uq_analysis_jobs_active_full_analysis", table_name="analysis_jobs")
    op.drop_index(op.f("ix_analysis_runs_project_id"), table_name="analysis_runs")
    op.drop_index("ix_analysis_runs_repository_id_created_at", table_name="analysis_runs")
    op.drop_table("analysis_runs")
    op.execute("DELETE FROM analysis_jobs WHERE job_type = 'full_analysis'")

    # Rebuild the type without 'full_analysis'; two partial indexes depend on the column.
    op.drop_index("uq_analysis_jobs_active_code_metrics", table_name="analysis_jobs")
    op.drop_index("uq_analysis_jobs_active_ingestion", table_name="analysis_jobs")
    op.execute("ALTER TYPE analysis_job_type RENAME TO analysis_job_type_0004")
    op.execute("CREATE TYPE analysis_job_type AS ENUM ('ingestion', 'code_metrics')")
    op.execute(
        "ALTER TABLE analysis_jobs ALTER COLUMN job_type TYPE analysis_job_type "
        "USING job_type::text::analysis_job_type"
    )
    op.execute("DROP TYPE analysis_job_type_0004")
    op.create_index(
        "uq_analysis_jobs_active_ingestion",
        "analysis_jobs",
        ["repository_id"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_INGESTION),
    )
    op.create_index(
        "uq_analysis_jobs_active_code_metrics",
        "analysis_jobs",
        ["repository_id"],
        unique=True,
        postgresql_where=sa.text(ACTIVE_CODE_METRICS),
    )
