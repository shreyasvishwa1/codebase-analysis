"""architecture reports

Adds the architecture_reports table (one architecture document per full-analysis run) and the
nullable analysis_runs.architecture column (the run's architecture summary; NULL for runs
stored before architecture analysis existed).

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("architecture", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "architecture_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_architecture_reports_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_architecture_reports")),
        sa.UniqueConstraint("run_id", name=op.f("uq_architecture_reports_run_id")),
    )


def downgrade() -> None:
    op.drop_table("architecture_reports")
    op.drop_column("analysis_runs", "architecture")
