import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

MAX_EMAIL_LENGTH = 320


def normalize_email(value: str) -> str:
    """Trim and lower-case an email, and check its basic shape (local@domain.tld)."""
    email = value.strip().lower()
    local, sep, domain = email.partition("@")
    if (
        not sep
        or not local
        or "@" in domain
        or "." not in domain
        or domain.startswith(".")
        or domain.endswith(".")
        or any(ch.isspace() for ch in email)
        or len(email) > MAX_EMAIL_LENGTH
    ):
        raise ValueError("must be a valid email address")
    return email


class _Credentials(BaseModel):
    email: str
    # SecretStr keeps the password out of reprs and logs. Its length is checked in the
    # register route rather than here, so validation errors never echo it back.
    password: SecretStr

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return normalize_email(value)


class RegisterRequest(_Credentials):
    pass


class LoginRequest(_Credentials):
    pass


class PasswordResetRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        return normalize_email(value)


class PasswordResetConfirm(BaseModel):
    token: SecretStr
    # Length is checked in the route, so validation errors never echo the password back.
    password: SecretStr


class MessageResponse(BaseModel):
    detail: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


MAX_DISPLAY_NAME_LENGTH = 80


class ProfileUpdate(BaseModel):
    """The display name; empty or blank removes it."""

    display_name: str | None = Field(default=None, max_length=200)

    @field_validator("display_name")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        if value is None:
            return None
        name = " ".join(value.split())
        if len(name) > MAX_DISPLAY_NAME_LENGTH:
            raise ValueError(f"must be at most {MAX_DISPLAY_NAME_LENGTH} characters")
        return name or None


class PasswordChange(BaseModel):
    # Lengths are checked in the route, so validation errors never echo a password back.
    current_password: SecretStr
    new_password: SecretStr


class AccountDeletion(BaseModel):
    password: SecretStr


class AccountSummary(BaseModel):
    """What the account holds."""

    projects: int
    repositories: int
    analyses: int
    reports: int
    conversations: int
    latest_analysis_at: datetime | None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str | None
    created_at: datetime
    updated_at: datetime
