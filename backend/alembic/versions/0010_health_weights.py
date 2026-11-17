"""health weights

Adds the nullable users.health_weights column: the user's Code Health Score weights per
dimension (NULL means the documented defaults). Health scores themselves are computed from
each run's stored summaries when they are read, so nothing else is stored.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("health_weights", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "health_weights")
