"""Password rules: length limits, common and trivial passwords, and the account's own email.

Unit tests need nothing; API tests reuse the auth API fixtures (throwaway test database).
"""

import os

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes import auth as auth_routes
from app.config import get_settings
from app.core.passwords import (
    COMMON_PASSWORDS,
    IS_EMAIL,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    TOO_COMMON,
    TOO_LONG,
    TOO_SHORT,
    password_problem,
)
from app.models import User
from app.services.password_reset import create_reset_token
from tests import test_auth_api as auth_tests

db_session = auth_tests.db_session
client = auth_tests.client
requires_db = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="set TEST_DATABASE_URL to a dedicated, already-migrated test database",
)

GOOD = "violet-harbour-lantern"


# --- Unit tests --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("password", "problem"),
    [
        ("short1!", TOO_SHORT),
        ("x" * (MAX_PASSWORD_LENGTH + 1), TOO_LONG),
        ("password1", TOO_COMMON),
        ("PassWord123", TOO_COMMON),  # case does not matter
        ("12345678", TOO_COMMON),
        ("qwertyuiop", TOO_COMMON),
        ("aaaaaaaaaa", TOO_COMMON),  # one character
        ("abababababab", TOO_COMMON),  # fewer than four different characters
    ],
)
def test_weak_passwords_are_refused_with_the_reason(password: str, problem: str) -> None:
    assert password_problem(password) == problem


@pytest.mark.parametrize(
    "password",
    [GOOD, "abcdabcd", "x" * (MAX_PASSWORD_LENGTH - 4) + "abcd", "ünïcödé-pässwörd"],
)
def test_reasonable_passwords_are_accepted(password: str) -> None:
    assert password_problem(password) is None
    assert password_problem(password, "someone@example.com") is None


def test_the_accounts_email_or_its_name_part_is_refused() -> None:
    assert password_problem("Alice.Smith@Example.com", "alice.smith@example.com") == IS_EMAIL
    assert password_problem("alice.smith", "alice.smith@example.com") == IS_EMAIL
    assert password_problem("alice.smith-2026", "alice.smith@example.com") is None


def test_the_common_list_only_holds_passwords_long_enough_to_matter() -> None:
    assert all(len(p) >= MIN_PASSWORD_LENGTH and p == p.lower() for p in COMMON_PASSWORDS)


# --- API ---------------------------------------------------------------------------------


async def _register(c: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await c.post("/api/v1/auth/register", json={"email": email, "password": password})


@requires_db
@pytest.mark.parametrize(
    ("password", "detail"),
    [
        ("password123", TOO_COMMON),
        ("x" * (MAX_PASSWORD_LENGTH + 1), TOO_LONG),
        ("dana@example.com", IS_EMAIL),
        ("short", TOO_SHORT),
    ],
)
async def test_sign_up_refuses_weak_passwords(
    client: httpx.AsyncClient, password: str, detail: str
) -> None:
    response = await _register(client, "dana@example.com", password)
    assert (response.status_code, response.json()) == (422, {"detail": detail})


@requires_db
async def test_an_oversized_sign_in_password_is_refused_without_hashing(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert (await _register(client, "erin@example.com", GOOD)).status_code == 201
    hashed: list[int] = []
    original = auth_routes.verify_password

    def counting(password: str, password_hash: str) -> bool:
        hashed.append(len(password))
        return original(password, password_hash)

    monkeypatch.setattr(auth_routes, "verify_password", counting)
    response = await client.post(
        "/api/v1/auth/login", json={"email": "erin@example.com", "password": "y" * 1_000_000}
    )
    assert (response.status_code, response.json()) == (401, {"detail": "Invalid email or password"})
    assert hashed == []  # refused before any hashing
    ok = await client.post(
        "/api/v1/auth/login", json={"email": "erin@example.com", "password": GOOD}
    )
    assert ok.status_code == 200 and hashed == [len(GOOD)]


@requires_db
async def test_changing_to_a_weak_password_is_refused(client: httpx.AsyncClient) -> None:
    assert (await _register(client, "fay@example.com", GOOD)).status_code == 201
    login = await client.post(
        "/api/v1/auth/login", json={"email": "fay@example.com", "password": GOOD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    for new, detail in (("iloveyou1", TOO_COMMON), ("fay@example.com", IS_EMAIL)):
        response = await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": GOOD, "new_password": new},
            headers=headers,
        )
        assert (response.status_code, response.json()) == (422, {"detail": detail})


@requires_db
async def test_resetting_to_a_weak_password_is_refused(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    assert (await _register(client, "gus@example.com", GOOD)).status_code == 201
    user = await db_session.scalar(select(User).where(User.email == "gus@example.com"))
    assert user is not None
    token = create_reset_token(get_settings(), user.id, user.password_hash)
    for new, detail in (("12345678", TOO_COMMON), ("gus@example.com", IS_EMAIL)):
        response = await client.post(
            "/api/v1/auth/password-reset/confirm", json={"token": token, "password": new}
        )
        assert (response.status_code, response.json()) == (422, {"detail": detail})
    ok = await client.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "password": "new-" + GOOD}
    )
    assert ok.status_code == 200
