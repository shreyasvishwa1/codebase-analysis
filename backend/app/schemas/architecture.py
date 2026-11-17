import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ComponentRole = Literal["ui", "api", "auth", "worker", "core", "data", "config", "test"]


class EvidenceItem(BaseModel):
    path: str
    line: int
    detail: str


class Component(BaseModel):
    id: str  # the component's directory ("(root)" for files at the repository root)
    files: int
    code_lines: int
    languages: list[str]
    role: ComponentRole  # places the component in the diagram
    roles: list[ComponentRole]
    evidence: dict[str, list[EvidenceItem]]  # role -> files showing it
    depends_on: int  # components it imports
    used_by: int  # components importing it


class Edge(BaseModel):
    source: str
    target: str
    imports: int
    examples: list[EvidenceItem]


class Technology(BaseModel):
    name: str
    category: str
    ecosystem: str
    evidence: list[EvidenceItem]


class DataStore(BaseModel):
    name: str
    evidence: list[EvidenceItem]


class RouteItem(BaseModel):
    method: str
    path: str  # as declared in its file (with that file's router prefix)
    file: str
    line: int
    framework: str


class EntryPoint(BaseModel):
    kind: str
    path: str
    line: int
    detail: str


class InfrastructureItem(BaseModel):
    kind: str
    path: str
    line: int
    detail: str


class ComposeService(BaseModel):
    name: str
    file: str
    image: str | None
    build: bool
    ports: list[str]
    depends_on: list[str]
    data_store: str | None


class Observation(BaseModel):
    title: str
    detail: str
    evidence: list[EvidenceItem]


class Truncated(BaseModel):
    edges: bool
    routes: bool
    entry_points: bool
    infrastructure: bool


class ArchitectureDocument(BaseModel):
    depth: int
    components: list[Component]
    edges: list[Edge]
    cycles: list[list[str]]
    technologies: list[Technology]
    data_stores: list[DataStore]
    routes: list[RouteItem]
    entry_points: list[EntryPoint]
    infrastructure: list[InfrastructureItem]
    services: list[ComposeService]
    observations: list[Observation]
    truncated: Truncated


class ArchitectureSummary(BaseModel):
    source_files: int
    components: int
    edges: int
    imports: int
    routes: int
    entry_points: int
    technologies: list[str]
    data_stores: list[str]
    infrastructure: int
    services: int
    cycles: int
    observations: int


class ArchitectureReportResponse(BaseModel):
    run_id: uuid.UUID
    created_at: datetime
    document: ArchitectureDocument


class RepositoryArchitecture(BaseModel):
    """A repository's latest run with architecture results (Architecture overview)."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    analyzed_file_count: int
    code_lines: int
    architecture: ArchitectureSummary


class ArchitectureOverviewResponse(BaseModel):
    repositories: list[RepositoryArchitecture]
