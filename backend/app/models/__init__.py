"""SQLAlchemy models. Importing this package registers every table on ``Base.metadata``."""

from app.models.analysis_job import AnalysisJob
from app.models.analysis_run import AnalysisRun
from app.models.architecture_report import ArchitectureReport
from app.models.base import Base
from app.models.code_issue import CodeIssue
from app.models.complexity import ComplexityFile, ComplexityFunction
from app.models.dependency_record import DependencyRecord
from app.models.enums import (
    AnalysisJobStatus,
    AnalysisJobType,
    RepositorySourceType,
    RepositoryStatus,
)
from app.models.file import File
from app.models.file_metric import FileMetric
from app.models.project import Project
from app.models.repository import Repository
from app.models.security_finding import SecurityFinding
from app.models.user import User

__all__ = [
    "AnalysisJob",
    "AnalysisRun",
    "ArchitectureReport",
    "AnalysisJobStatus",
    "AnalysisJobType",
    "Base",
    "CodeIssue",
    "ComplexityFile",
    "ComplexityFunction",
    "DependencyRecord",
    "File",
    "FileMetric",
    "Project",
    "Repository",
    "RepositorySourceType",
    "RepositoryStatus",
    "SecurityFinding",
    "User",
]
