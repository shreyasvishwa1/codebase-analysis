from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StrictInt

from app.services.usability import HIGHEST_ANSWER, LOWEST_ANSWER, STATEMENTS

Answer = Annotated[StrictInt, Field(ge=LOWEST_ANSWER, le=HIGHEST_ANSWER)]


class UsabilityAnswers(BaseModel):
    """The ten answers, in statement order, each from 1 (strongly disagree) to 5 (strongly agree)."""

    answers: list[Answer] = Field(min_length=len(STATEMENTS), max_length=len(STATEMENTS))


class UsabilityMine(BaseModel):
    """The questionnaire and the signed-in account's own response, if it has answered."""

    statements: list[str]
    answers: list[int] | None
    score: float | None
    grade: str | None
    updated_at: datetime | None


class UsabilityItem(BaseModel):
    number: int
    statement: str
    positive: bool  # agreeing is good (odd statements); for the others, disagreeing is
    mean: float | None


class UsabilityResults(BaseModel):
    """All responses, anonymously: the mean SUS score and its grade, the spread, each
    statement's mean answer and the number of responses in each grade group."""

    responses: int
    mean: float | None
    grade: str | None
    median: float | None
    standard_deviation: float | None
    lowest: float | None
    highest: float | None
    average_benchmark: float
    items: list[UsabilityItem]
    grades: dict[str, int]
