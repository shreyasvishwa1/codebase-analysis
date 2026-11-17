"""complexity

Adds the complexity_files and complexity_functions tables (the complexity metrics of a
full-analysis run) and the nullable analysis_runs.complexity column (the run's complexity
summary; NULL for runs stored before complexity analysis existed).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RANK_VALID = "rank IN ('low', 'medium', 'high')"
MAINTAINABILITY_VALID = "maintainability IS NULL OR maintainability IN ('good', 'moderate', 'poor')"
FILE_COUNTS_VALID = (
    "nloc >= 0 AND functions >= 0 AND classes >= 0 AND total_cyclomatic >= 0"
    " AND max_cyclomatic >= 0"
)
FUNCTION_COUNTS_VALID = "cyclomatic >= 1 AND nloc >= 0 AND parameters >= 0"
LINES_VALID = "line >= 1 AND end_line >= line"


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("complexity", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "complexity_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=32), nullable=False),
        sa.Column("nloc", sa.Integer(), nullable=False),
        sa.Column("functions", sa.Integer(), nullable=False),
        sa.Column("classes", sa.Integer(), nullable=False),
        sa.Column("total_cyclomatic", sa.Integer(), nullable=False),
        sa.Column("max_cyclomatic", sa.Integer(), nullable=False),
        sa.Column("average_cyclomatic", sa.Float(), nullable=False),
        sa.Column("rank", sa.String(length=8), nullable=False),
        sa.Column("maintainability_index", sa.Float(), nullable=True),
        sa.Column("maintainability", sa.String(length=16), nullable=True),
        sa.Column("mi_estimated", sa.Boolean(), nullable=False),
        sa.CheckConstraint(RANK_VALID, name=op.f("ck_complexity_files_rank_valid")),
        sa.CheckConstraint(
            MAINTAINABILITY_VALID, name=op.f("ck_complexity_files_maintainability_valid")
        ),
        sa.CheckConstraint(FILE_COUNTS_VALID, name=op.f("ck_complexity_files_counts_valid")),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_complexity_files_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_complexity_files")),
        sa.UniqueConstraint("run_id", "path", name=op.f("uq_complexity_files_run_id_path")),
    )
    op.create_index(
        "ix_complexity_files_run_id_max_cyclomatic",
        "complexity_files",
        ["run_id", "max_cyclomatic"],
    )
    op.create_table(
        "complexity_functions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("cyclomatic", sa.Integer(), nullable=False),
        sa.Column("nloc", sa.Integer(), nullable=False),
        sa.Column("parameters", sa.Integer(), nullable=False),
        sa.Column("rank", sa.String(length=8), nullable=False),
        sa.CheckConstraint(RANK_VALID, name=op.f("ck_complexity_functions_rank_valid")),
        sa.CheckConstraint(LINES_VALID, name=op.f("ck_complexity_functions_lines_valid")),
        sa.CheckConstraint(
            FUNCTION_COUNTS_VALID, name=op.f("ck_complexity_functions_counts_valid")
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_complexity_functions_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_complexity_functions")),
    )
    op.create_index(
        "ix_complexity_functions_run_id_cyclomatic",
        "complexity_functions",
        ["run_id", "cyclomatic"],
    )
    op.create_index(
        "ix_complexity_functions_run_id_path", "complexity_functions", ["run_id", "path"]
    )


def downgrade() -> None:
    op.drop_index("ix_complexity_functions_run_id_path", table_name="complexity_functions")
    op.drop_index("ix_complexity_functions_run_id_cyclomatic", table_name="complexity_functions")
    op.drop_table("complexity_functions")
    op.drop_index("ix_complexity_files_run_id_max_cyclomatic", table_name="complexity_files")
    op.drop_table("complexity_files")
    op.drop_column("analysis_runs", "complexity")
