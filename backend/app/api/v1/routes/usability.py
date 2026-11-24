"""The usability questionnaire (System Usability Scale): each signed-in account answers it once
and may change its answers; everyone signed in sees the results, anonymously, and can
download the anonymous answers as CSV for analysis."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies import get_current_user
from app.database import get_db
from app.models import UsabilityResponse, User
from app.schemas.usability import UsabilityAnswers, UsabilityMine, UsabilityResults
from app.services import usability

router = APIRouter(prefix="/usability", tags=["usability"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

CSV_FILENAME = "sus-responses.csv"


def _mine(response: UsabilityResponse | None) -> UsabilityMine:
    answers = list(response.answers) if response is not None else None
    value = usability.score(answers) if answers is not None else None
    return UsabilityMine(
        statements=list(usability.STATEMENTS),
        answers=answers,
        score=value,
        grade=usability.grade(value) if value is not None else None,
        updated_at=response.updated_at if response is not None else None,
    )


async def _own(db: AsyncSession, user: User) -> UsabilityResponse | None:
    return await db.scalar(select(UsabilityResponse).where(UsabilityResponse.user_id == user.id))


@router.get("/me", response_model=UsabilityMine)
async def get_my_response(db: DbSession, user: CurrentUser) -> UsabilityMine:
    return _mine(await _own(db, user))


@router.put("/me", response_model=UsabilityMine)
async def save_my_response(body: UsabilityAnswers, db: DbSession, user: CurrentUser) -> UsabilityMine:
    """Record the account's answers, replacing any it gave before (one response per account,
    also when two saves race)."""
    # The wall-clock time, not the transaction's start: respondents stay numbered in the order
    # they answered even when several answers are stored within one transaction.
    statement = (
        insert(UsabilityResponse)
        .values(
            id=uuid.uuid4(),
            user_id=user.id,
            answers=body.answers,
            created_at=func.clock_timestamp(),
            updated_at=func.clock_timestamp(),
        )
        .on_conflict_do_update(
            index_elements=[UsabilityResponse.user_id],
            set_={"answers": body.answers, "updated_at": func.clock_timestamp()},
        )
    )
    await db.execute(statement)
    await db.commit()
    return _mine(await _own(db, user))


async def _all(db: AsyncSession) -> list[UsabilityResponse]:
    rows = await db.scalars(
        select(UsabilityResponse).order_by(UsabilityResponse.created_at, UsabilityResponse.id)
    )
    return list(rows)


@router.get("/results", response_model=UsabilityResults)
async def get_results(db: DbSession, _user: CurrentUser) -> UsabilityResults:
    responses = await _all(db)
    return UsabilityResults(**usability.summarize([list(r.answers) for r in responses]))


@router.get("/results.csv")
async def download_results(db: DbSession, _user: CurrentUser) -> Response:
    responses = await _all(db)
    text = usability.responses_csv([(r.created_at, list(r.answers)) for r in responses])
    return Response(
        content=text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{CSV_FILENAME}"'},
    )
