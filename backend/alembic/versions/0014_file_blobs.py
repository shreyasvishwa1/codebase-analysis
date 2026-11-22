"""file blobs

Adds file_blobs: every ingested file's bytes, compressed and keyed by SHA-256, so the
repository folder can be rebuilt after the server's disk is reset (no new upload needed).
Adds an index on files.sha256 for the maintenance job that removes unused contents.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "file_blobs",
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("sha256", name=op.f("pk_file_blobs")),
    )
    op.create_index(op.f("ix_files_sha256"), "files", ["sha256"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_files_sha256"), table_name="files")
    op.drop_table("file_blobs")
