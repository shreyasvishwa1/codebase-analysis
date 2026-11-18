"""generated reports

Adds generated_reports: the PDF reports of analysis runs, kept for their users with their
size, SHA-256 and page count.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "generated_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("repository_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("pages", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_generated_reports_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_generated_reports_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["repository_id"],
            ["repositories.id"],
            name=op.f("fk_generated_reports_repository_id_repositories"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_generated_reports_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_generated_reports")),
    )
    op.create_index(
        "ix_generated_reports_user_id_created_at", "generated_reports", ["user_id", "created_at"]
    )
    op.create_index("ix_generated_reports_run_id", "generated_reports", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_generated_reports_run_id", table_name="generated_reports")
    op.drop_index("ix_generated_reports_user_id_created_at", table_name="generated_reports")
    op.drop_table("generated_reports")
