from datetime import datetime

from sqlalchemy import BigInteger, DateTime, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class FileBlob(Base):
    """A stored file's bytes, compressed and keyed by SHA-256 (identical files are kept once).

    The copy that survives when the server's disk is reset (Render's free plan wipes it on
    every restart, sleep or redeploy): the repository folder is rebuilt from these rows, so
    an uploaded repository never has to be uploaded again. Rows are not tied to one
    repository; maintenance removes those no file refers to any more.
    """

    __tablename__ = "file_blobs"

    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)  # before compression
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)  # zlib-compressed
    # Refreshed whenever an ingestion stores or reuses the row; garbage collection only
    # removes rows unused for a while, so an ingestion still in progress never loses one.
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
