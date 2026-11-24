"""The usability questionnaire (System Usability Scale): scoring, grading, the summary, the
anonymous CSV and the API. Unit tests need nothing; API tests reuse the auth API fixtures
(throwaway test database, rolled back)."""

import csv
import io
import os
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UsabilityResponse, User
from app.services import usability
from tests import test_auth_api as auth_tests

db_session = auth_tests.db_session
client = auth_tests.client

requires_db = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="set TEST_DATABASE_URL to a dedicated, already-migrated test database",
)

BEST = [5, 1, 5, 1, 5, 1, 5, 1, 5, 1]  # agree with every positive, disagree with every negative
WORST = [1, 5, 1, 5, 1, 5, 1, 5, 1, 5]
GOOD = [4, 2, 4, 2, 4, 2, 4, 2, 4, 2]  # each answer contributes 3: 30 x 2.5 = 75


# --- Scoring ------------------------------------------------------------------------------------


def test_the_ten_statements_alternate_positive_and_negative() -> None:
    assert len(usability.STATEMENTS) == 10
    assert [usability.is_positive(n) for n in range(1, 11)] == [True, False] * 5
    assert usability.STATEMENTS[0] == "I think that I would like to use this app frequently."
    assert usability.STATEMENTS[1] == "I found the app unnecessarily complex."


@pytest.mark.parametrize(
    ("answers", "expected"),
    [
        (BEST, 100.0),
        (WORST, 0.0),
        ([3] * 10, 50.0),
        (GOOD, 75.0),
        ([5, 2, 4, 1, 4, 2, 5, 1, 4, 2], 85.0),  # 4+3+3+4+3+3+4+4+3+3 = 34
        ([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 50.0),  # agreeing with everything cancels out
    ],
)
def test_scores_follow_the_sus_formula(answers: list[int], expected: float) -> None:
    assert usability.score(answers) == expected


@pytest.mark.parametrize(
    "answers",
    [[3] * 9, [3] * 11, [3] * 9 + [0], [3] * 9 + [6], [3] * 9 + [True], [3] * 9 + [3.0], []],
)
def test_incomplete_or_out_of_range_answers_are_refused(answers: list) -> None:  # type: ignore[type-arg]
    assert not usability.valid(answers)
    with pytest.raises(ValueError):
        usability.score(answers)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (100.0, "A+"), (84.1, "A+"), (84.0, "A"), (80.8, "A"), (80.7, "A-"), (78.9, "A-"),
        (78.8, "B+"), (77.2, "B+"), (74.1, "B"), (74.0, "B-"), (72.6, "B-"), (72.5, "C+"),
        (71.1, "C+"), (71.0, "C"), (68.0, "C"), (65.0, "C"), (64.9, "C-"), (62.7, "C-"),
        (62.6, "D"), (51.7, "D"), (51.6, "F"), (0.0, "F"),
    ],
)  # fmt: skip
def test_grades_follow_the_curved_grading_scale(value: float, expected: str) -> None:
    assert usability.grade(value) == expected


def test_an_empty_summary_has_no_numbers_and_empty_groups() -> None:
    summary = usability.summarize([])
    assert summary["responses"] == 0
    for key in ("mean", "grade", "median", "standard_deviation", "lowest", "highest"):
        assert summary[key] is None
    assert [item["mean"] for item in summary["items"]] == [None] * 10
    assert summary["grades"] == {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    assert summary["average_benchmark"] == 68.0


def test_the_summary_of_several_responses() -> None:
    summary = usability.summarize([BEST, GOOD, [3] * 10])  # 100, 75, 50
    assert summary["responses"] == 3
    assert (summary["mean"], summary["grade"], summary["median"]) == (75.0, "B", 75.0)
    assert summary["standard_deviation"] == 25.0
    assert (summary["lowest"], summary["highest"]) == (50.0, 100.0)
    assert summary["items"][0] == {
        "number": 1, "statement": usability.STATEMENTS[0], "positive": True, "mean": 4.0,
    }  # fmt: skip
    assert summary["items"][1]["mean"] == 2.0 and summary["items"][1]["positive"] is False
    assert summary["grades"] == {"A": 1, "B": 1, "C": 0, "D": 0, "F": 1}


def test_one_response_has_no_standard_deviation() -> None:
    summary = usability.summarize([GOOD])
    assert summary["standard_deviation"] is None
    assert summary["mean"] == summary["median"] == summary["lowest"] == 75.0


def test_the_csv_is_anonymous_numbered_and_dated() -> None:
    text = usability.responses_csv(
        [(datetime(2026, 11, 24, 9, 30, tzinfo=UTC), GOOD), (datetime(2026, 11, 25, 18, 5, tzinfo=UTC), BEST)]
    )
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == ["respondent", *[f"q{n}" for n in range(1, 11)], "score", "date"]
    assert rows[1] == ["1", *map(str, GOOD), "75", "2026-11-24"]
    assert rows[2] == ["2", *map(str, BEST), "100", "2026-11-25"]
    assert "9:30" not in text and "18:05" not in text  # the day only


# --- API ----------------------------------------------------------------------------------------


async def _signed_in(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    assert (await auth_tests._register(client, email)).status_code == 201
    token = (await auth_tests._login(client, email)).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@requires_db
@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "/me"), ("PUT", "/me"), ("GET", "/results"), ("GET", "/results.csv")],
)
async def test_every_endpoint_needs_a_signed_in_account(client: httpx.AsyncClient, method: str, path: str) -> None:
    response = await client.request(method, f"/api/v1/usability{path}", json={"answers": GOOD})
    assert response.status_code == 401


@requires_db
async def test_an_account_answers_once_and_can_change_its_answers(
    client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    headers = await _signed_in(client, "tester@example.com")
    before = (await client.get("/api/v1/usability/me", headers=headers)).json()
    assert before == {
        "statements": list(usability.STATEMENTS), "answers": None, "score": None, "grade": None, "updated_at": None,
    }  # fmt: skip

    saved = await client.put("/api/v1/usability/me", headers=headers, json={"answers": GOOD})
    assert saved.status_code == 200
    assert (saved.json()["answers"], saved.json()["score"], saved.json()["grade"]) == (GOOD, 75.0, "B")

    changed = await client.put("/api/v1/usability/me", headers=headers, json={"answers": BEST})
    assert (changed.json()["answers"], changed.json()["score"]) == (BEST, 100.0)
    assert (await client.get("/api/v1/usability/me", headers=headers)).json()["answers"] == BEST
    count = await db_session.scalar(select(func.count()).select_from(UsabilityResponse))
    assert count == 1


@requires_db
@pytest.mark.parametrize(
    "answers",
    [[3] * 9, [3] * 11, [3] * 9 + [0], [3] * 9 + [6], [3] * 9 + ["3"], [3] * 9 + [True], [3] * 9 + [3.0], None],
)
async def test_invalid_answers_are_refused_and_nothing_is_stored(
    client: httpx.AsyncClient, db_session: AsyncSession, answers: object
) -> None:
    headers = await _signed_in(client, "tester@example.com")
    response = await client.put("/api/v1/usability/me", headers=headers, json={"answers": answers})
    assert response.status_code == 422
    assert await db_session.scalar(select(func.count()).select_from(UsabilityResponse)) == 0


@requires_db
async def test_results_and_the_csv_cover_every_account_anonymously(client: httpx.AsyncClient) -> None:
    first = await _signed_in(client, "first@example.com")
    second = await _signed_in(client, "second@example.com")
    empty = (await client.get("/api/v1/usability/results", headers=first)).json()
    assert empty["responses"] == 0 and empty["mean"] is None

    await client.put("/api/v1/usability/me", headers=first, json={"answers": GOOD})
    await client.put("/api/v1/usability/me", headers=second, json={"answers": BEST})
    results = (await client.get("/api/v1/usability/results", headers=second)).json()
    assert (results["responses"], results["mean"], results["grade"]) == (2, 87.5, "A+")
    assert results["grades"] == {"A": 1, "B": 1, "C": 0, "D": 0, "F": 0}
    assert len(results["items"]) == 10

    download = await client.get("/api/v1/usability/results.csv", headers=first)
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("text/csv")
    assert download.headers["content-disposition"] == 'attachment; filename="sus-responses.csv"'
    rows = list(csv.reader(io.StringIO(download.text)))
    assert [row[-2] for row in rows[1:]] == ["75", "100"]  # in the order they answered
    assert "example.com" not in download.text


@requires_db
async def test_deleting_an_account_deletes_its_answers(client: httpx.AsyncClient, db_session: AsyncSession) -> None:
    headers = await _signed_in(client, "leaver@example.com")
    await client.put("/api/v1/usability/me", headers=headers, json={"answers": GOOD})
    await db_session.execute(delete(User).where(User.email == "leaver@example.com"))
    await db_session.flush()
    assert await db_session.scalar(select(func.count()).select_from(UsabilityResponse)) == 0


@requires_db
async def test_the_database_refuses_answers_out_of_range(db_session: AsyncSession) -> None:
    user = User(email="direct@example.com", password_hash="x")
    db_session.add(user)
    await db_session.flush()
    db_session.add(UsabilityResponse(user_id=user.id, answers=[3] * 9 + [9]))
    with pytest.raises(IntegrityError):
        await db_session.flush()
