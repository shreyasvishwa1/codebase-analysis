import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_QUESTION_CHARS = 2000


class ChatQuestion(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)

    @field_validator("question")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("The question must not be empty")
        return value


class ChatStatus(BaseModel):
    configured: bool  # an AI provider key is set on the server


class ChatCitation(BaseModel):
    n: int
    path: str
    start_line: int
    end_line: int
    symbol: str | None


class ChatMessageResponse(BaseModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    citations: list[ChatCitation]
    created_at: datetime


class ChatConversationSummary(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    repository_id: uuid.UUID
    run_id: uuid.UUID
    run_created_at: datetime  # the analysis the conversation is about
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int


class ChatConversationListResponse(BaseModel):
    conversations: list[ChatConversationSummary]  # most recently updated first


class ChatConversationDetail(ChatConversationSummary):
    messages: list[ChatMessageResponse]  # oldest first


class ChatExchange(BaseModel):
    """A question and its answer, added to a conversation."""

    conversation: ChatConversationSummary
    messages: list[ChatMessageResponse]


class ChatRepository(BaseModel):
    """A repository whose latest analysis can be chatted about."""

    project_id: uuid.UUID
    project_name: str
    repository_id: uuid.UUID
    repository_name: str
    run_id: uuid.UUID
    created_at: datetime
    chunks: int
    files: int


class RecentConversation(ChatConversationSummary):
    repository_name: str


class ChatOverviewResponse(BaseModel):
    configured: bool
    repositories: list[ChatRepository]
    conversations: list[RecentConversation]  # the user's most recent, across repositories
