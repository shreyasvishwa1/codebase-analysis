"""The AI codebase chat: conversations about one repository, answered from its latest
analysis (code passages and analysis results) with citations, and kept as history.

Checks run in this order: repository ownership (404), the conversation (404), the AI
provider's configuration (503), an analysis that can be chatted about (409), the per-user
rate limit (429), then the provider (502). A question and its answer are stored together,
only once the answer exists."""

import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import LLMProvider
from app.ai.selection import get_llm_provider
from app.analysis.results import latest_runs_with, run_entry
from app.api.v1.dependencies import get_current_user
from app.api.v1.routes.health_score import weights_of
from app.api.v1.routes.repositories import _get_owned_repository
from app.chat.service import CHAT_LIMIT, NOT_CONFIGURED, Answer, ChatError, answer
from app.database import get_db
from app.models import AnalysisRun, ChatConversation, ChatMessage, Repository, User
from app.schemas.chat import (
    ChatConversationDetail,
    ChatConversationListResponse,
    ChatConversationSummary,
    ChatExchange,
    ChatMessageResponse,
    ChatOverviewResponse,
    ChatQuestion,
    ChatRepository,
    ChatStatus,
    RecentConversation,
)
from app.services.rate_limit import RateLimit

CONVERSATION_NOT_FOUND = "Conversation not found"
NOT_INDEXED = "Run a full analysis of this repository to chat about it"
TITLE_CHARS = 80
LIST_LIMIT = 100
RECENT_LIMIT = 10

router = APIRouter(
    prefix="/projects/{project_id}/repositories/{repository_id}/chat",
    tags=["ai chat"],
    dependencies=[Depends(get_current_user)],
)
overview_router = APIRouter(prefix="/chat", tags=["ai chat"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Provider = Annotated[LLMProvider | None, Depends(get_llm_provider)]


def title_of(question: str) -> str:
    text = re.sub(r"\s+", " ", question).strip()
    return text if len(text) <= TITLE_CHARS else text[: TITLE_CHARS - 1].rstrip() + "…"


def _summary_query() -> Select[Any]:
    count = (
        select(func.count())
        .where(ChatMessage.conversation_id == ChatConversation.id)
        .correlate(ChatConversation)
        .scalar_subquery()
    )
    return (
        select(ChatConversation, AnalysisRun.created_at, count, Repository.name)
        .join(AnalysisRun, AnalysisRun.id == ChatConversation.run_id)
        .join(Repository, Repository.id == ChatConversation.repository_id)
    )


def _summary(row: Any) -> dict[str, Any]:
    conversation, run_created_at, count, repository_name = row
    return {
        "id": conversation.id,
        "project_id": conversation.project_id,
        "repository_id": conversation.repository_id,
        "run_id": conversation.run_id,
        "run_created_at": run_created_at,
        "title": conversation.title,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "message_count": count,
        "repository_name": repository_name,
    }


async def _summary_of(db: AsyncSession, conversation_id: uuid.UUID) -> ChatConversationSummary:
    row = (await db.execute(_summary_query().where(ChatConversation.id == conversation_id))).one()
    return ChatConversationSummary(**_summary(row))


def _message(message: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=message.id,
        role=message.role,  # type: ignore[arg-type]
        content=message.content,
        citations=message.citations,  # type: ignore[arg-type]
        created_at=message.created_at,
    )


async def _messages(db: AsyncSession, conversation_id: uuid.UUID) -> list[ChatMessage]:
    return list(
        await db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            # On equal timestamps (rows written in one statement batch), a question comes
            # before its answer.
            .order_by(
                ChatMessage.created_at,
                case((ChatMessage.role == "user", 0), else_=1),
                ChatMessage.id,
            )
        )
    )


async def _conversation(
    db: AsyncSession, repository: Repository, user: User, conversation_id: uuid.UUID
) -> ChatConversation:
    conversation = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.id == conversation_id,
            ChatConversation.repository_id == repository.id,
            ChatConversation.user_id == user.id,
        )
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail=CONVERSATION_NOT_FOUND)
    return conversation


async def _chat_run(db: AsyncSession, repository_id: uuid.UUID) -> AnalysisRun | None:
    """The latest run with a chat index (runs stored before phase 8 have none)."""
    return await db.scalar(
        select(AnalysisRun)
        .where(AnalysisRun.repository_id == repository_id, AnalysisRun.chat_index.is_not(None))
        .order_by(AnalysisRun.created_at.desc(), AnalysisRun.id.desc())
        .limit(1)
    )


async def _ask(
    db: AsyncSession,
    provider: LLMProvider,
    run: AnalysisRun,
    repository: Repository,
    user: User,
    question: str,
    turns: list[tuple[str, str]],
) -> Answer:
    try:
        return await answer(db, provider, run, repository.name, weights_of(user), question, turns)
    except ChatError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from None


async def _store_exchange(
    db: AsyncSession, conversation: ChatConversation, question: str, result: Answer
) -> list[ChatMessage]:
    """The question and the answer, in this order (clock_timestamp keeps them apart)."""
    stored = []
    for message in (
        ChatMessage(conversation_id=conversation.id, role="user", content=question, citations=[]),
        ChatMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=result.text,
            citations=result.citations,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        ),
    ):
        message.created_at = func.clock_timestamp()  # type: ignore[assignment]
        db.add(message)
        await db.flush()
        await db.refresh(message)
        stored.append(message)
    conversation.updated_at = func.clock_timestamp()  # type: ignore[assignment]
    await db.flush()
    return stored


@router.get("/conversations", response_model=ChatConversationListResponse)
async def list_conversations(
    project_id: uuid.UUID, repository_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> ChatConversationListResponse:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    rows = await db.execute(
        _summary_query()
        .where(ChatConversation.repository_id == repository.id, ChatConversation.user_id == user.id)
        .order_by(ChatConversation.updated_at.desc(), ChatConversation.id)
        .limit(LIST_LIMIT)
    )
    return ChatConversationListResponse(
        conversations=[ChatConversationSummary(**_summary(row)) for row in rows.all()]
    )


@router.post(
    "/conversations", response_model=ChatConversationDetail, status_code=status.HTTP_201_CREATED
)
async def start_conversation(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    body: ChatQuestion,
    db: DbSession,
    user: CurrentUser,
    limiter: RateLimit,
    provider: Provider,
) -> ChatConversationDetail:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    if provider is None:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    run = await _chat_run(db, repository.id)
    if run is None:
        raise HTTPException(status_code=409, detail=NOT_INDEXED)
    await limiter.hit(CHAT_LIMIT, str(user.id))
    result = await _ask(db, provider, run, repository, user, body.question, [])
    conversation = ChatConversation(
        user_id=user.id,
        project_id=repository.project_id,
        repository_id=repository.id,
        run_id=run.id,
        title=title_of(body.question),
    )
    db.add(conversation)
    await db.flush()
    stored = await _store_exchange(db, conversation, body.question, result)
    await db.commit()
    summary = await _summary_of(db, conversation.id)
    return ChatConversationDetail(**summary.model_dump(), messages=[_message(m) for m in stored])


@router.get("/conversations/{conversation_id}", response_model=ChatConversationDetail)
async def get_conversation(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    conversation_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> ChatConversationDetail:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    conversation = await _conversation(db, repository, user, conversation_id)
    summary = await _summary_of(db, conversation.id)
    messages = await _messages(db, conversation.id)
    return ChatConversationDetail(**summary.model_dump(), messages=[_message(m) for m in messages])


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ChatExchange,
    status_code=status.HTTP_201_CREATED,
)
async def ask_in_conversation(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    conversation_id: uuid.UUID,
    body: ChatQuestion,
    db: DbSession,
    user: CurrentUser,
    limiter: RateLimit,
    provider: Provider,
) -> ChatExchange:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    conversation = await _conversation(db, repository, user, conversation_id)
    if provider is None:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    run = await db.get(AnalysisRun, conversation.run_id)
    if run is None or run.chat_index is None:  # pragma: no cover - the FK cascades
        raise HTTPException(status_code=409, detail=NOT_INDEXED)
    await limiter.hit(CHAT_LIMIT, str(user.id))
    turns = [(m.role, m.content) for m in await _messages(db, conversation.id)]
    result = await _ask(db, provider, run, repository, user, body.question, turns)
    stored = await _store_exchange(db, conversation, body.question, result)
    await db.commit()
    return ChatExchange(
        conversation=await _summary_of(db, conversation.id),
        messages=[_message(m) for m in stored],
    )


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    project_id: uuid.UUID,
    repository_id: uuid.UUID,
    conversation_id: uuid.UUID,
    db: DbSession,
    user: CurrentUser,
) -> Response:
    repository = await _get_owned_repository(db, project_id, repository_id, user)
    conversation = await _conversation(db, repository, user, conversation_id)
    await db.delete(conversation)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@overview_router.get("/status", response_model=ChatStatus)
async def chat_status(user: CurrentUser, provider: Provider) -> ChatStatus:
    return ChatStatus(configured=provider is not None)


@overview_router.get("", response_model=ChatOverviewResponse)
async def chat_overview(
    db: DbSession, user: CurrentUser, provider: Provider
) -> ChatOverviewResponse:
    repositories = []
    for run, project, repository in await latest_runs_with(db, user.id, "chat_index"):
        entry = run_entry(run, project, repository)
        repositories.append(
            ChatRepository(
                **{
                    k: entry[k]
                    for k in ("project_id", "project_name", "repository_id", "repository_name")
                },
                run_id=run.id,
                created_at=run.created_at,
                chunks=int(run.chat_index["chunks"]),  # type: ignore[index]
                files=int(run.chat_index["files"]),  # type: ignore[index]
            )
        )
    rows = await db.execute(
        _summary_query()
        .where(ChatConversation.user_id == user.id)
        .order_by(ChatConversation.updated_at.desc(), ChatConversation.id)
        .limit(RECENT_LIMIT)
    )
    return ChatOverviewResponse(
        configured=provider is not None,
        repositories=repositories,
        conversations=[RecentConversation(**_summary(row)) for row in rows.all()],
    )
