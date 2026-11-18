"""The signed-in user's account (Module 10): profile, password change, account deletion and
summary, and sessions bound to the password.

API tests reuse the full-analysis fixtures (the throwaway test database inside rolled-back
transactions)."""

import uuid
from typing import Any

import httpx
import jwt
import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.auth import PASSWORD_CHECK_USER, SAME_PASSWORD, WRONG_PASSWORD
from app.config import get_settings
from app.core.security import (
    InvalidTokenError,
    create_access_token,
    decode_access_claims,
    password_fingerprint,
)
from app.main import app
from app.models import (
    AnalysisRun,
    ChatConversation,
    GeneratedReport,
    Project,
    Repository,
    User,
)
from app.services.password_reset import create_reset_token
from app.services.rate_limit import Limit, RateLimiter, get_rate_limiter
from tests import test_analysis_runs as runs_tests
from tests.test_analysis_runs import (
    FILES,
    PASSWORD,
    Owner,
    _ingest,
    _runs,
    _runs_url,
    inline_analysis,
    requires_db,
)

# The full-analysis fixtures, shared (assigned, so pytest registers them in this module).
db_session = runs_tests.db_session
data_dir = runs_tests.data_dir
client = runs_tests.client
alice = runs_tests.alice
bob = runs_tests.bob

NEW_PASSWORD = "another-test-Passw0rd!"
ME = "/api/v1/auth/me"

# --- Tokens -------------------------------------------------------------------------------------


def test_tokens_carry_the_password_fingerprint() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id, "argon2-hash")
    assert decode_access_claims(token) == (user_id, password_fingerprint("argon2-hash"))
    assert decode_access_claims(create_access_token(user_id)) == (user_id, None)
    assert password_fingerprint("a") != password_fingerprint("b")
    assert len(password_fingerprint("a")) == 32
    settings = get_settings()
    odd = jwt.encode(
        {"sub": str(user_id), "exp": 4102444800, "pwd": 7},
        settings.secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(InvalidTokenError):
        decode_access_claims(odd)


# --- API ----------------------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _user(db_session: AsyncSession, email: str) -> User:
    db_session.expire_all()
    user = await db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    return user


@requires_db
async def test_sessions_end_when_the_password_changes(
    client: httpx.AsyncClient, alice: Owner, db_session: AsyncSession
) -> None:
    user = await _user(db_session, "alice@example.com")
    unbound = create_access_token(user.id)  # issued before tokens carried the fingerprint
    assert (await client.get(ME, headers=_auth(unbound))).status_code == 200
    stale = create_access_token(user.id, "an earlier password hash")
    assert (await client.get(ME, headers=_auth(stale))).status_code == 401
    claims = decode_access_claims(alice.headers["Authorization"].removeprefix("Bearer "))
    assert claims == (user.id, password_fingerprint(user.password_hash))  # login binds the token
    # A password reset ends existing sessions too.
    reset = create_reset_token(get_settings(), user.id, user.password_hash)
    response = await client.post(
        "/api/v1/auth/password-reset/confirm", json={"token": reset, "password": NEW_PASSWORD}
    )
    assert response.status_code == 200
    assert (await client.get(ME, headers=alice.headers)).status_code == 401


@requires_db
async def test_profile(client: httpx.AsyncClient, alice: Owner) -> None:
    me = (await client.get(ME, headers=alice.headers)).json()
    assert me["display_name"] is None
    response = await client.patch(
        ME, json={"display_name": "  Alice   Smith "}, headers=alice.headers
    )
    assert response.status_code == 200
    assert response.json()["display_name"] == "Alice Smith"
    assert (await client.get(ME, headers=alice.headers)).json()["display_name"] == "Alice Smith"
    assert (await client.patch(ME, json={"display_name": "   "}, headers=alice.headers)).json()[
        "display_name"
    ] is None
    assert (
        await client.patch(ME, json={"display_name": "A" * 80}, headers=alice.headers)
    ).status_code == 200
    assert (
        await client.patch(ME, json={"display_name": "A" * 81}, headers=alice.headers)
    ).status_code == 422
    assert (await client.patch(ME, json={}, headers=alice.headers)).json()["display_name"] is None
    assert (await client.patch(ME, json={"display_name": "x"})).status_code == 401


async def _change(
    client: httpx.AsyncClient, headers: dict[str, str], current: str, new: str
) -> httpx.Response:
    return await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": current, "new_password": new},
        headers=headers,
    )


@requires_db
async def test_change_password(
    client: httpx.AsyncClient, alice: Owner, bob: Owner, db_session: AsyncSession
) -> None:
    before = (await _user(db_session, "alice@example.com")).password_hash
    wrong = await _change(client, alice.headers, "not-the-password", NEW_PASSWORD)
    assert (wrong.status_code, wrong.json()) == (400, {"detail": WRONG_PASSWORD})
    short = await _change(client, alice.headers, PASSWORD, "short")
    assert (short.status_code, short.json()["detail"]) == (
        422,
        "Password must be at least 8 characters long",
    )
    same = await _change(client, alice.headers, PASSWORD, PASSWORD)
    assert (same.status_code, same.json()) == (422, {"detail": SAME_PASSWORD})
    assert (await _user(db_session, "alice@example.com")).password_hash == before

    changed = await _change(client, alice.headers, PASSWORD, NEW_PASSWORD)
    assert changed.status_code == 200
    token = changed.json()["access_token"]
    new_hash = (await _user(db_session, "alice@example.com")).password_hash
    assert decode_access_claims(token)[1] == password_fingerprint(new_hash)  # bound to it too
    assert changed.json()["token_type"] == "bearer"
    assert (await client.get(ME, headers=alice.headers)).status_code == 401  # the old session ended
    assert (await client.get(ME, headers=_auth(token))).json()["email"] == "alice@example.com"
    assert (await client.get(ME, headers=bob.headers)).status_code == 200  # other users unaffected
    login = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": NEW_PASSWORD}
    )
    assert login.status_code == 200
    old = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD}
    )
    assert old.status_code == 401
    assert (await _change(client, {}, PASSWORD, NEW_PASSWORD)).status_code == 401


class RecordingLimiter(RateLimiter):
    def __init__(self, refuse: bool = False) -> None:
        super().__init__(None)
        self.hits: list[tuple[Limit, str]] = []
        self.refuse = refuse

    async def hit(self, limit: Limit, value: str) -> None:
        self.hits.append((limit, value))
        if self.refuse:
            raise HTTPException(status_code=429, detail="Too many requests")


@requires_db
async def test_password_checks_are_rate_limited(
    client: httpx.AsyncClient, alice: Owner, db_session: AsyncSession
) -> None:
    user = await _user(db_session, "alice@example.com")
    limiter = RecordingLimiter()
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    await _change(client, alice.headers, "not-the-password", NEW_PASSWORD)
    await client.request("DELETE", ME, json={"password": "not-the-password"}, headers=alice.headers)
    assert limiter.hits == [(PASSWORD_CHECK_USER, str(user.id))] * 2
    assert (PASSWORD_CHECK_USER.max_requests, PASSWORD_CHECK_USER.window_seconds) == (5, 900)
    app.dependency_overrides[get_rate_limiter] = lambda: RecordingLimiter(refuse=True)
    assert (await _change(client, alice.headers, PASSWORD, NEW_PASSWORD)).status_code == 429
    refused = await client.request("DELETE", ME, json={"password": PASSWORD}, headers=alice.headers)
    assert refused.status_code == 429
    assert (await _user(db_session, "alice@example.com")).password_hash == user.password_hash


async def _analyzed(
    client: httpx.AsyncClient,
    owner: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> dict[str, Any]:
    await _ingest(client, owner, FILES)
    outcomes = inline_analysis(monkeypatch, db_session)
    assert (await client.post(_runs_url(owner), headers=owner.headers)).status_code == 202
    assert outcomes[-1] == "completed"
    return dict((await _runs(client, owner))["runs"][0])


@requires_db
async def test_account_summary(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    empty = (await client.get(f"{ME}/summary", headers=alice.headers)).json()
    assert empty == {
        "projects": 1,
        "repositories": 1,
        "analyses": 0,
        "reports": 0,
        "conversations": 0,
        "latest_analysis_at": None,
    }
    await _analyzed(client, alice, monkeypatch, db_session)
    run = await _analyzed(client, alice, monkeypatch, db_session)
    await client.post(f"{_runs_url(alice)}/{run['id']}/reports", headers=alice.headers)
    user = await _user(db_session, "alice@example.com")
    db_session.add(
        ChatConversation(
            user_id=user.id,
            project_id=uuid.UUID(alice.project_id),
            repository_id=uuid.UUID(alice.repository_id),
            run_id=uuid.UUID(run["id"]),
            title="Question",
        )
    )
    await db_session.flush()
    summary = (await client.get(f"{ME}/summary", headers=alice.headers)).json()
    assert summary == {
        "projects": 1,
        "repositories": 1,
        "analyses": 2,
        "reports": 1,
        "conversations": 1,
        "latest_analysis_at": run["created_at"],
    }
    other = (await client.get(f"{ME}/summary", headers=bob.headers)).json()
    assert (other["analyses"], other["reports"], other["conversations"]) == (0, 0, 0)
    assert (await client.get(f"{ME}/summary")).status_code == 401


@requires_db
async def test_delete_account(
    client: httpx.AsyncClient,
    alice: Owner,
    bob: Owner,
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
) -> None:
    run = await _analyzed(client, alice, monkeypatch, db_session)
    await client.post(f"{_runs_url(alice)}/{run['id']}/reports", headers=alice.headers)
    bob_run = await _analyzed(client, bob, monkeypatch, db_session)
    wrong = await client.request(
        "DELETE", ME, json={"password": "not-the-password"}, headers=alice.headers
    )
    assert (wrong.status_code, wrong.json()) == (400, {"detail": WRONG_PASSWORD})
    assert (await client.request("DELETE", ME, json={}, headers=alice.headers)).status_code == 422
    assert (await client.request("DELETE", ME, json={"password": PASSWORD})).status_code == 401
    alice_id = (await _user(db_session, "alice@example.com")).id

    deleted = await client.request("DELETE", ME, json={"password": PASSWORD}, headers=alice.headers)
    assert (deleted.status_code, deleted.content) == (204, b"")
    assert (await client.get(ME, headers=alice.headers)).status_code == 401
    db_session.expire_all()
    assert await db_session.get(User, alice_id) is None
    for model, column in (
        (Project, Project.user_id),
        (GeneratedReport, GeneratedReport.user_id),
        (ChatConversation, ChatConversation.user_id),
    ):
        assert (
            await db_session.scalar(
                select(func.count()).select_from(model).where(column == alice_id)
            )
            == 0
        )
    for model, column, value in (
        (Repository, Repository.id, alice.repository_id),
        (AnalysisRun, AnalysisRun.id, run["id"]),
    ):
        assert (
            await db_session.scalar(
                select(func.count()).select_from(model).where(column == uuid.UUID(value))
            )
            == 0
        )
    # Bob keeps everything.
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(AnalysisRun)
            .where(AnalysisRun.id == uuid.UUID(bob_run["id"]))
        )
        == 1
    )
    assert (await client.get(ME, headers=bob.headers)).status_code == 200
    login = await client.post(
        "/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD}
    )
    assert login.status_code == 401
