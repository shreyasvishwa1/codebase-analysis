"""code issues

Adds the code_issues table (the code-quality findings of a full-analysis run) and the
nullable analysis_runs.quality column (the run's code-quality summary; NULL for runs stored
before code-quality analysis existed).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-17

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEVERITY_VALID = "severity IN ('high', 'medium', 'low', 'info')"
CATEGORY_VALID = (
    "category IN ('syntax_error', 'bug_risk', 'unused_code', 'dead_code', 'duplication', "
    "'naming', 'documentation', 'formatting', 'maintainability')"
)
LINES_VALID = "line >= 1 AND end_line >= line"


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("quality", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "code_issues",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("column", sa.Integer(), nullable=True),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("tool", sa.String(length=32), nullable=False),
        sa.Column("rule_id", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("suggestion", sa.Text(), nullable=False),
        sa.Column("doc_url", sa.Text(), nullable=True),
        sa.CheckConstraint(SEVERITY_VALID, name=op.f("ck_code_issues_severity_valid")),
        sa.CheckConstraint(CATEGORY_VALID, name=op.f("ck_code_issues_category_valid")),
        sa.CheckConstraint(LINES_VALID, name=op.f("ck_code_issues_lines_valid")),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_code_issues_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_code_issues")),
    )
    op.create_index("ix_code_issues_run_id_severity", "code_issues", ["run_id", "severity"])
    op.create_index("ix_code_issues_run_id_category", "code_issues", ["run_id", "category"])
    op.create_index("ix_code_issues_run_id_path", "code_issues", ["run_id", "path"])


def downgrade() -> None:
    op.drop_index("ix_code_issues_run_id_path", table_name="code_issues")
    op.drop_index("ix_code_issues_run_id_category", table_name="code_issues")
    op.drop_index("ix_code_issues_run_id_severity", table_name="code_issues")
    op.drop_table("code_issues")
    op.drop_column("analysis_runs", "quality")
