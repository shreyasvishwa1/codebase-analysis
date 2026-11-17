from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.project import Project


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    # Storage only; hashing is implemented with authentication in a later step.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # The user's Code Health Score weights (dimension -> weight); NULL means the defaults.
    health_weights: Mapped[dict[str, int] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    projects: Mapped[list["Project"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", passive_deletes=True
    )
