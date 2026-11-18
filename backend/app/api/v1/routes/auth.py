import hmac
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies import get_current_user
from app.core.security import (
    create_access_token,
    dummy_password_hash,
    hash_password,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.models import AnalysisRun, ChatConversation, GeneratedReport, Project, Repository, User
from app.schemas.auth import (
    MIN_PASSWORD_LENGTH,
    AccountDeletion,
    AccountSummary,
    LoginRequest,
    MessageResponse,
    PasswordChange,
    PasswordResetConfirm,
    PasswordResetRequest,
    ProfileUpdate,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.password_reset import (
    InvalidResetToken,
    create_reset_token,
    password_fingerprint,
    read_reset_token,
    reset_link,
    send_reset_email,
)
from app.services.rate_limit import (
    Limit,
    RESET_CONFIRM_IP,
    RESET_REQUEST_EMAIL,
    RESET_REQUEST_IP,
    RateLimit,
    client_ip,
)

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

DUPLICATE_ACCOUNT = "An account with this email already exists"
INVALID_CREDENTIALS = "Invalid email or password"
RESET_DISABLED = "Password reset by email is not available"
RESET_REQUESTED = "If an account exists for that email, a reset link is on its way"
INVALID_RESET_LINK = "This reset link is invalid or has expired; request a new one"
RESET_DONE = "Your password has been reset; you can now sign in"
WRONG_PASSWORD = "The current password is incorrect"
SAME_PASSWORD = "Choose a password different from the current one"
# Password checks of a signed-in user (change password, delete account), per user.
PASSWORD_CHECK_USER = Limit("password-check-user", 5, 15 * 60)

CurrentUser = Annotated[User, Depends(get_current_user)]


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=INVALID_CREDENTIALS,
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest, db: DbSession, request: Request, limiter: RateLimit
) -> User:
    await limiter.check_register_ip(client_ip(request))  # every attempt counts
    password = body.password.get_secret_value()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters long",
        )

    if await db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_ACCOUNT)

    user = User(email=body.email, password_hash=hash_password(password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # Concurrent registration with the same email hit the unique constraint.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=DUPLICATE_ACCOUNT
        ) from None
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, db: DbSession, request: Request, limiter: RateLimit
) -> TokenResponse:
    # Rate limits are checked before any database lookup or password hashing.
    await limiter.check_login_ip(client_ip(request))
    async with limiter.login_attempt(body.email) as attempt:
        password = body.password.get_secret_value()
        user = await db.scalar(select(User).where(User.email == body.email))
        if user is None:
            verify_password(password, dummy_password_hash())  # similar timing for unknown emails
            attempt.failed()
            raise _invalid_credentials()
        if not verify_password(password, user.password_hash):
            attempt.failed()
            raise _invalid_credentials()
        return TokenResponse(access_token=create_access_token(user.id, user.password_hash))


@router.post(
    "/password-reset/request",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_password_reset(
    body: PasswordResetRequest,
    db: DbSession,
    request: Request,
    limiter: RateLimit,
    background: BackgroundTasks,
) -> MessageResponse:
    settings = get_settings()
    if not settings.password_reset_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=RESET_DISABLED)
    await limiter.hit(RESET_REQUEST_IP, client_ip(request))
    await limiter.hit(RESET_REQUEST_EMAIL, body.email)
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is not None:
        token = create_reset_token(settings, user.id, user.password_hash)
        # Sent after the response, so known and unknown emails take the same time to answer.
        background.add_task(send_reset_email, settings, user.email, reset_link(settings, token))
    return MessageResponse(detail=RESET_REQUESTED)


@router.post("/password-reset/confirm", response_model=MessageResponse)
async def confirm_password_reset(
    body: PasswordResetConfirm, db: DbSession, request: Request, limiter: RateLimit
) -> MessageResponse:
    await limiter.hit(RESET_CONFIRM_IP, client_ip(request))
    password = body.password.get_secret_value()
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters long",
        )
    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_RESET_LINK)
    try:
        user_id, fingerprint = read_reset_token(get_settings(), body.token.get_secret_value())
    except InvalidResetToken:
        raise invalid from None
    user = await db.get(User, user_id)
    if user is None or not hmac.compare_digest(
        fingerprint, password_fingerprint(user.password_hash)
    ):
        raise invalid  # unknown user, or the password already changed (link used)
    user.password_hash = hash_password(password)
    await db.commit()
    return MessageResponse(detail=RESET_DONE)


@router.get("/me", response_model=UserResponse)
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    return current_user


@router.patch("/me", response_model=UserResponse)
async def update_profile(body: ProfileUpdate, db: DbSession, user: CurrentUser) -> User:
    user.display_name = body.display_name
    await db.commit()
    await db.refresh(user)
    return user


def _new_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters long",
        )
    return password


async def _check_password(limiter: RateLimit, user: User, password: str) -> None:
    """The signed-in user's password, rate limited per user (5 checks per 15 minutes)."""
    await limiter.hit(PASSWORD_CHECK_USER, str(user.id))
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG_PASSWORD)


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    body: PasswordChange, db: DbSession, user: CurrentUser, limiter: RateLimit
) -> TokenResponse:
    """Change the password. Every session started before ends (their tokens carry the old
    password's fingerprint); the response holds a new token for this one."""
    new = _new_password(body.new_password.get_secret_value())
    await _check_password(limiter, user, body.current_password.get_secret_value())
    if verify_password(new, user.password_hash):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=SAME_PASSWORD)
    user.password_hash = hash_password(new)
    await db.commit()
    return TokenResponse(access_token=create_access_token(user.id, user.password_hash))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: AccountDeletion, db: DbSession, user: CurrentUser, limiter: RateLimit
) -> Response:
    """Delete the account and everything in it: projects, repositories, analyses, reports
    and conversations go with it (ON DELETE CASCADE); stored repository files are removed by
    the maintenance sweep, as when a repository is deleted."""
    await _check_password(limiter, user, body.password.get_secret_value())
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/summary", response_model=AccountSummary)
async def account_summary(db: DbSession, user: CurrentUser) -> AccountSummary:
    owned = Project.user_id == user.id

    async def count(statement: object) -> int:
        return int(await db.scalar(statement) or 0)  # type: ignore[call-overload]

    return AccountSummary(
        projects=await count(select(func.count()).select_from(Project).where(owned)),
        repositories=await count(
            select(func.count())
            .select_from(Repository)
            .join(Project, Project.id == Repository.project_id)
            .where(owned)
        ),
        analyses=await count(
            select(func.count())
            .select_from(AnalysisRun)
            .join(Project, Project.id == AnalysisRun.project_id)
            .where(owned)
        ),
        reports=await count(
            select(func.count())
            .select_from(GeneratedReport)
            .where(GeneratedReport.user_id == user.id)
        ),
        conversations=await count(
            select(func.count())
            .select_from(ChatConversation)
            .where(ChatConversation.user_id == user.id)
        ),
        latest_analysis_at=await db.scalar(
            select(func.max(AnalysisRun.created_at))
            .join(Project, Project.id == AnalysisRun.project_id)
            .where(owned)
        ),
    )
