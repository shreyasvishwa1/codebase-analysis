"""Password hashing (Argon2) and JWT access tokens.

Nothing in this module logs or returns passwords, hashes' inputs, or tokens.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.config import get_settings

# argon2id with argon2-cffi's recommended parameters; a random salt is generated per hash.
_password_hasher = PasswordHasher()


class InvalidTokenError(Exception):
    """The access token is missing, malformed, expired, badly signed or has an invalid subject."""


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return True only if the password matches; any verification problem returns False."""
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


@lru_cache
def dummy_password_hash() -> str:
    """A valid hash of a random value, used to keep login timing similar for unknown emails."""
    return _password_hasher.hash(uuid.uuid4().hex)


def password_fingerprint(password_hash: str) -> str:
    """A short digest of the stored password hash: it changes whenever the password does."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:32]


def create_access_token(user_id: uuid.UUID, password_hash: str | None = None) -> str:
    """A signed token for ``user_id``. With ``password_hash``, the token carries its
    fingerprint (``pwd``), so changing the password ends every session started before."""
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    payload: dict[str, object] = {"sub": str(user_id), "exp": expires_at}
    if password_hash is not None:
        payload["pwd"] = password_fingerprint(password_hash)
    return jwt.encode(
        payload, settings.secret_key.get_secret_value(), algorithm=settings.jwt_algorithm
    )


def decode_access_claims(token: str) -> tuple[uuid.UUID, str | None]:
    """Validate the token and return the user id (``sub``) and the password fingerprint
    (``pwd``; None in tokens issued without one)."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
        fingerprint = payload.get("pwd")
        if fingerprint is not None and not isinstance(fingerprint, str):
            raise InvalidTokenError
        return uuid.UUID(payload["sub"]), fingerprint
    except (jwt.PyJWTError, ValueError, TypeError, AttributeError):
        raise InvalidTokenError from None


def decode_access_token(token: str) -> uuid.UUID:
    """Validate the token and return the user id from its ``sub`` claim."""
    return decode_access_claims(token)[0]
