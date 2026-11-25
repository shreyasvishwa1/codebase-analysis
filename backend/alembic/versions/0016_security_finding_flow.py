"""security finding flow

Adds security_findings.flow: for data-flow findings, the path request input took to the
dangerous call, as [[line, label], ...]. Nullable, so older runs and older code keep working.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-25

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "security_findings",
        sa.Column("flow", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("security_findings", "flow")
