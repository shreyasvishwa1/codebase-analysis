"""Password reset by email, without storing reset tokens.

A reset token is a JWT signed with a key derived from SECRET_KEY for this purpose only, so a
reset token is never a valid access token and an access token is never a valid reset token.
It carries the user id, an expiry and a fingerprint of the user's current password hash:
once the password changes, every earlier token stops working, which makes each token
single-use. Tokens travel only in the URL fragment of the reset link (``#token=``), which
browsers do not send to servers. Nothing here logs addresses, tokens or passwords.
"""

import hashlib
import hmac
import logging
import smtplib
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import httpx
import jwt

from app.config import Settings

# Shared with access tokens: one fingerprint scheme for every password-bound token.
from app.core.security import password_fingerprint

logger = logging.getLogger(__name__)

PURPOSE = "password-reset"
ALGORITHM = "HS256"
SMTP_TIMEOUT_SECONDS = 20
BREVO_URL = "https://api.brevo.com/v3/smtp/email"
BREVO_TIMEOUT_SECONDS = 20
SENDER_NAME = "CodeBase Analysis"
SUBJECT = "Reset your CodeBase Analysis password"


class InvalidResetToken(Exception):
    """The reset token is malformed, expired, badly signed or already used."""


def _signing_key(settings: Settings) -> bytes:
    return hmac.new(
        settings.secret_key.get_secret_value().encode(), PURPOSE.encode(), hashlib.sha256
    ).digest()


def create_reset_token(settings: Settings, user_id: uuid.UUID, password_hash: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.password_reset_token_minutes
    )
    payload = {
        "sub": str(user_id),
        "exp": expires_at,
        "purpose": PURPOSE,
        "pwd": password_fingerprint(password_hash),
    }
    return jwt.encode(payload, _signing_key(settings), algorithm=ALGORITHM)


def read_reset_token(settings: Settings, token: str) -> tuple[uuid.UUID, str]:
    """The user id and password fingerprint in a valid token; raises InvalidResetToken."""
    try:
        payload = jwt.decode(
            token,
            _signing_key(settings),
            algorithms=[ALGORITHM],
            options={"require": ["exp", "sub", "purpose", "pwd"]},
        )
        if payload["purpose"] != PURPOSE or not isinstance(payload["pwd"], str):
            raise InvalidResetToken
        return uuid.UUID(payload["sub"]), payload["pwd"]
    except (jwt.PyJWTError, ValueError, TypeError, AttributeError, KeyError):
        raise InvalidResetToken from None


def reset_link(settings: Settings, token: str) -> str:
    return f"{settings.app_base_url}/reset-password#token={token}"


def _content(settings: Settings, link: str) -> tuple[str, str]:
    """The plain-text and HTML bodies of the reset email."""
    minutes = settings.password_reset_token_minutes
    text = (
        "Someone asked to reset the password for your CodeBase Analysis account.\n\n"
        f"Reset it here (the link works once and expires in {minutes} minutes):\n{link}\n\n"
        "If you didn't ask for this, ignore this email; your password stays the same.\n"
    )
    html = f"""<!doctype html>
<html><body style="margin:0;background:#0b1020;font-family:Segoe UI,Arial,sans-serif;color:#e2e8f0">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111827;border-radius:16px;overflow:hidden;border:1px solid #1f2937">
<tr><td style="padding:24px 28px;background:linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4);color:#fff;font-size:20px;font-weight:700">CodeBase Analysis</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#fff">Reset your password</p>
<p style="margin:0 0 24px;line-height:1.6;color:#cbd5e1">Someone asked to reset the password for your account. The link works once and expires in {minutes} minutes.</p>
<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#6366f1;color:#fff;text-decoration:none;font-weight:600">Reset password</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8">If you didn't ask for this, ignore this email; your password stays the same.</p>
</td></tr></table></td></tr></table></body></html>"""
    return text, html


def _message(settings: Settings, recipient: str, link: str) -> EmailMessage:
    text, html = _content(settings, link)
    message = EmailMessage()
    message["Subject"] = SUBJECT
    message["From"] = f"{SENDER_NAME} <{settings.sender_address}>"
    message["To"] = recipient
    message.set_content(text)
    message.add_alternative(html, subtype="html")
    return message


def send_reset_email(settings: Settings, recipient: str, link: str) -> None:
    """Send the reset email through Brevo's HTTPS API when BREVO_API_KEY is set, otherwise
    over SMTP with STARTTLS. Failures are logged without details that identify the
    recipient, and never reach the client."""
    if not settings.password_reset_enabled:
        return
    if settings.email_transport == "brevo":
        _send_brevo(settings, recipient, link)
    else:
        _send_smtp(settings, recipient, link)


def _send_brevo(settings: Settings, recipient: str, link: str) -> None:
    if settings.brevo_api_key is None:
        return
    text, html = _content(settings, link)
    body = {
        "sender": {"name": SENDER_NAME, "email": settings.sender_address},
        "to": [{"email": recipient}],
        "subject": SUBJECT,
        "htmlContent": html,
        "textContent": text,
    }
    headers = {"api-key": settings.brevo_api_key.get_secret_value(), "accept": "application/json"}
    try:
        response = httpx.post(
            BREVO_URL,
            json=body,
            headers=headers,
            timeout=BREVO_TIMEOUT_SECONDS,
            follow_redirects=False,
        )
    except httpx.HTTPError as exc:
        logger.warning("Password reset email could not be sent (%s)", type(exc).__name__)
        return
    if response.status_code not in (201, 202):
        # Only the status: Brevo's error body can echo the recipient address.
        logger.warning(
            "Password reset email could not be sent (Brevo HTTP %s)", response.status_code
        )


def _send_smtp(settings: Settings, recipient: str, link: str) -> None:
    if settings.smtp_password is None:
        return
    try:
        with smtplib.SMTP(
            settings.smtp_host or "", settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS
        ) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(settings.smtp_username or "", settings.smtp_password.get_secret_value())
            smtp.send_message(_message(settings, recipient, link))
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("Password reset email could not be sent (%s)", type(exc).__name__)
