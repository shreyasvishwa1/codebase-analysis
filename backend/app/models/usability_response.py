import uuid

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UsabilityResponse(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One account's answers to the usability questionnaire (the System Usability Scale,
    app.services.usability): ten answers from 1 to 5. One response per account, which the
    account can change; deleting the account deletes it. Results show it only anonymously."""

    __tablename__ = "usability_responses"
    __table_args__ = (
        CheckConstraint(
            "cardinality(answers) = 10 AND 1 <= ALL(answers) AND 5 >= ALL(answers)",
            name="answers_range",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    answers: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)
