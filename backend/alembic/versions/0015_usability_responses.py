"""usability responses

Adds usability_responses: each account's answers to the System Usability Scale
questionnaire (ten answers from 1 to 5), one per account, deleted with the account.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-24

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "usability_responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("answers", postgresql.ARRAY(sa.SmallInteger()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "cardinality(answers) = 10 AND 1 <= ALL(answers) AND 5 >= ALL(answers)",
            name=op.f("ck_usability_responses_answers_range"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_usability_responses_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_usability_responses")),
        sa.UniqueConstraint("user_id", name=op.f("uq_usability_responses_user_id")),
    )


def downgrade() -> None:
    op.drop_table("usability_responses")
