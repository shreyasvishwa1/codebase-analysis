"""security findings

Adds the security_findings table (the security findings of a full-analysis run) and the
nullable analysis_runs.security column (the run's security summary; NULL for runs stored
before security analysis existed).

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEVERITY_VALID = "severity IN ('critical', 'high', 'medium', 'low')"
CONFIDENCE_VALID = "confidence IN ('confirmed', 'potential')"
OWASP_VALID = "owasp IN ('A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10')"
LINES_VALID = "line >= 1 AND end_line >= line"


def upgrade() -> None:
    op.add_column(
        "analysis_runs",
        sa.Column("security", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_table(
        "security_findings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("tool", sa.String(length=32), nullable=False),
        sa.Column("rule_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("owasp", sa.String(length=3), nullable=False),
        sa.Column("cwe", sa.Integer(), nullable=True),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("confidence", sa.String(length=16), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("doc_url", sa.Text(), nullable=True),
        sa.CheckConstraint(SEVERITY_VALID, name=op.f("ck_security_findings_severity_valid")),
        sa.CheckConstraint(CONFIDENCE_VALID, name=op.f("ck_security_findings_confidence_valid")),
        sa.CheckConstraint(OWASP_VALID, name=op.f("ck_security_findings_owasp_valid")),
        sa.CheckConstraint(LINES_VALID, name=op.f("ck_security_findings_lines_valid")),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["analysis_runs.id"],
            name=op.f("fk_security_findings_run_id_analysis_runs"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_security_findings")),
    )
    op.create_index(
        "ix_security_findings_run_id_severity", "security_findings", ["run_id", "severity"]
    )
    op.create_index("ix_security_findings_run_id_owasp", "security_findings", ["run_id", "owasp"])
    op.create_index("ix_security_findings_run_id_path", "security_findings", ["run_id", "path"])


def downgrade() -> None:
    op.drop_index("ix_security_findings_run_id_path", table_name="security_findings")
    op.drop_index("ix_security_findings_run_id_owasp", table_name="security_findings")
    op.drop_index("ix_security_findings_run_id_severity", table_name="security_findings")
    op.drop_table("security_findings")
    op.drop_column("analysis_runs", "security")
