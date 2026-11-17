import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

Weight = Field(ge=0, le=100)


class HealthWeights(BaseModel):
    """How much each dimension counts in the overall score (relative weights, 0-100 each;
    at least one must be above 0)."""

    security: int = Weight
    quality: int = Weight
    complexity: int = Weight
    maintainability: int = Weight
    dependencies: int = Weight
    architecture: int = Weight

    @model_validator(mode="after")
    def _some_weight(self) -> "HealthWeights":
        if not any(self.model_dump().values()):
            raise ValueError("At least one weight must be above 0")
        return self


class HealthWeightsResponse(BaseModel):
    weights: HealthWeights
    defaults: bool  # the documented default weights are in use


class HealthDimension(BaseModel):
    key: str
    name: str
    score: int | None  # None: not applicable to this run (left out of the average)
    weight: int
    inputs: dict[str, Any]
    explanation: str
    improvements: list[str]


class HealthReportResponse(BaseModel):
    run_id: uuid.UUID
    created_at: datetime
    overall: int | None
    grade: str | None
    weights: HealthWeights
    dimensions: list[HealthDimension]


class HealthPoint(BaseModel):
    run_id: uuid.UUID
    created_at: datetime
    overall: int | None
    grade: str | None
    scores: dict[str, int | None]


class HealthHistoryResponse(BaseModel):
    """A repository's scores over its runs, oldest first."""

    points: list[HealthPoint]


class RepositoryHealth(BaseModel):
    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    overall: int | None
    grade: str | None
    scores: dict[str, int | None]


class HealthOverviewResponse(BaseModel):
    weights: HealthWeights
    repositories: list[RepositoryHealth]
