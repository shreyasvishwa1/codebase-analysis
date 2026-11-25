"""Google Gemini implementation of the provider-neutral ``LLMProvider`` interface.

Calls the Gemini API's ``generateContent`` REST endpoint with ``httpx`` (no extra SDK).
Every connection setting is explicit: the destination is always API_BASE_URL, the key
travels only in the ``x-goog-api-key`` header (never in the URL, so it cannot reach access
logs), redirects are not followed, and timeout/retries are fixed. The model id is validated
in Settings because it is part of the request path.

Busy answers (429, 500, 502, 503, 504: the model is overloaded or rate limited) are retried
after RETRY_DELAYS; if the model is still busy, or the request times out, the fallback model
(GEMINI_FALLBACK_MODEL) is asked once. Other failures are not retried.

Only a complete answer is returned: a blocked prompt or a candidate stopped for safety or
any other non-``STOP`` reason is "declined", a token-limit stop is "incomplete", and every
transport, status or response-shape failure is "unavailable". Messages are fixed and no
vendor details are chained. Prompts, responses and the key are never logged.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
import threading
from typing import Any

import httpx

from app.ai.provider import ChatMessage, GenerationResult, LLMProvider, LLMProviderError
from app.config import get_settings

API_BASE_URL = "https://generativelanguage.googleapis.com"
TIMEOUT_SECONDS = 60.0
MAX_RETRIES = 2  # connection failures only (httpx transport retries)
RETRY_DELAYS = (1.0, 3.0)  # seconds before each retry of a busy model
BUSY_STATUSES = frozenset({429, 500, 502, 503, 504})

UNAVAILABLE = "The AI service is unavailable"
DECLINED = "The AI service declined this request"
INCOMPLETE = "The AI response was incomplete"
TEMPERATURE_UNSUPPORTED = "temperature is not supported by this provider"

_INCOMPLETE_REASONS = frozenset({"MAX_TOKENS", "CONTINUATION"})


class GeminiProvider(LLMProvider):
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        fallback_model: str | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        # ``client`` is a test seam only; production always builds the explicit client.
        self._model = model
        self._fallback = fallback_model if fallback_model and fallback_model != model else None
        self._client = client or httpx.AsyncClient(
            base_url=API_BASE_URL,
            headers={"x-goog-api-key": api_key},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            transport=httpx.AsyncHTTPTransport(retries=MAX_RETRIES),
        )

    def _body(
        self, messages: Sequence[ChatMessage], system: str | None, max_tokens: int
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "contents": [
                {
                    "role": "model" if m.role == "assistant" else "user",
                    "parts": [{"text": m.content}],
                }
                for m in messages
            ],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }
        if system is not None:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        return body

    @staticmethod
    def _parse(data: Any, fallback_model: str) -> GenerationResult:
        if not isinstance(data, dict):
            raise LLMProviderError(UNAVAILABLE)
        feedback = data.get("promptFeedback")
        if isinstance(feedback, dict) and feedback.get("blockReason"):
            raise LLMProviderError(DECLINED)
        candidates = data.get("candidates")
        if (
            not isinstance(candidates, list)
            or not candidates
            or not isinstance(candidates[0], dict)
        ):
            raise LLMProviderError(UNAVAILABLE)
        candidate = candidates[0]
        reason = candidate.get("finishReason")
        if reason in _INCOMPLETE_REASONS:
            raise LLMProviderError(INCOMPLETE)
        if reason != "STOP":
            raise LLMProviderError(DECLINED)
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            raise LLMProviderError(UNAVAILABLE)
        # Only answer text counts: thought summaries and non-text parts are ignored.
        text = "".join(
            part["text"]
            for part in parts
            if isinstance(part, dict)
            and isinstance(part.get("text"), str)
            and not part.get("thought")
        )
        usage = data.get("usageMetadata")
        usage = usage if isinstance(usage, dict) else {}
        model = data.get("modelVersion")

        def count(name: str) -> int | None:
            value = usage.get(name)
            return value if isinstance(value, int) and not isinstance(value, bool) else None

        return GenerationResult(
            text=text,
            model=model if isinstance(model, str) and model else fallback_model,
            input_tokens=count("promptTokenCount"),
            output_tokens=count("candidatesTokenCount"),
        )

    async def generate(
        self,
        messages: Sequence[ChatMessage],
        *,
        system: str | None = None,
        max_tokens: int,
        temperature: float | None = None,
    ) -> GenerationResult:
        if temperature is not None:
            raise LLMProviderError(TEMPERATURE_UNSUPPORTED)
        body = self._body(messages, system, max_tokens)
        busy = False
        for delay in (0.0, *RETRY_DELAYS):
            if delay:
                await asyncio.sleep(delay)
            busy, response = await self._post(self._model, body)
            if not busy:
                break
            if response is None:  # timed out: waiting again would double the wait
                break
        if busy and self._fallback is not None:
            busy, response = await self._post(self._fallback, body)
            model = self._fallback
        else:
            model = self._model
        if busy or response is None or response.status_code != 200:
            raise LLMProviderError(UNAVAILABLE)
        try:
            data = response.json()
        except ValueError:
            raise LLMProviderError(UNAVAILABLE) from None
        return self._parse(data, model)

    async def _post(self, model: str, body: dict[str, Any]) -> tuple[bool, httpx.Response | None]:
        """(busy, response): busy for an overloaded model or a timeout (response None)."""
        try:
            response = await self._client.post(f"/v1beta/models/{model}:generateContent", json=body)
        except httpx.TimeoutException:
            return True, None
        except httpx.HTTPError:
            raise LLMProviderError(UNAVAILABLE) from None
        return response.status_code in BUSY_STATUSES, response

    async def generate_stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        system: str | None = None,
        max_tokens: int,
        temperature: float | None = None,
    ) -> AsyncIterator[str]:
        # The complete, validated answer as one piece (the chat uses ``stream``).
        result = await self.generate(
            messages, system=system, max_tokens=max_tokens, temperature=temperature
        )
        yield result.text

    async def stream(
        self,
        messages: Sequence[ChatMessage],
        *,
        system: str | None = None,
        max_tokens: int,
        temperature: float | None = None,
    ) -> AsyncIterator[str | GenerationResult]:
        """Streams with ``streamGenerateContent`` (server-sent events). A busy model or a
        timeout before the first piece moves on to the fallback model, still streaming; if
        that is busy too, ``generate`` answers (with its retries) in one piece. The end of the
        stream is checked like a complete answer."""
        if temperature is not None:
            raise LLMProviderError(TEMPERATURE_UNSUPPORTED)
        body = self._body(messages, system, max_tokens)
        for model in (self._model, self._fallback):
            if model is None:
                continue
            pieces: list[str] = []
            last: dict[str, Any] = {}
            try:
                async for text, event in self._stream_from(model, body):
                    if text:
                        pieces.append(text)
                        yield text
                    last = event
            except _Busy:
                continue
            # The last event carries the finish reason and the usage; its text is replaced by
            # all of the text, so the end is validated exactly like a complete answer.
            candidates = last.get("candidates")
            candidate = (
                candidates[0]
                if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict)
                else {}
            )
            whole = {
                **last,
                "candidates": [{**candidate, "content": {"parts": [{"text": "".join(pieces)}]}}],
            }
            yield self._parse(whole, model)
            return
        result = await self.generate(messages, system=system, max_tokens=max_tokens)
        yield result.text
        yield result

    async def _stream_from(
        self, model: str, body: dict[str, Any]
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """(text, event) for each event of one model's stream. ``_Busy`` when the model is
        busy or times out before any text; other failures are ``LLMProviderError``."""
        started = False
        try:
            async with self._client.stream(
                "POST",
                f"/v1beta/models/{model}:streamGenerateContent",
                params={"alt": "sse"},
                json=body,
            ) as response:
                if response.status_code in BUSY_STATUSES:
                    raise _Busy
                if response.status_code != 200:
                    raise LLMProviderError(UNAVAILABLE)
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = _event(line[len("data:") :])
                    texts = _texts(data)
                    if not texts:
                        yield "", data
                    for text in texts:
                        started = True
                        yield text, data
        except httpx.TimeoutException:
            if started:
                raise LLMProviderError(UNAVAILABLE) from None
            raise _Busy from None
        except httpx.HTTPError:
            raise LLMProviderError(UNAVAILABLE) from None


class _Busy(Exception):
    """A model was busy (or slow) before it wrote anything: try the next one."""


def _event(payload: str) -> dict[str, Any]:
    """One server-sent event's JSON; a malformed event is an error (a blocked prompt is
    caught when the end of the stream is checked)."""
    try:
        data = json.loads(payload)
    except ValueError:
        raise LLMProviderError(UNAVAILABLE) from None
    if not isinstance(data, dict):
        raise LLMProviderError(UNAVAILABLE)
    return data


def _texts(data: dict[str, Any]) -> list[str]:
    """The answer text in one event (thought summaries and non-text parts are ignored)."""
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
        return []
    content = candidates[0].get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return []
    return [
        part["text"]
        for part in parts
        if isinstance(part, dict)
        and isinstance(part.get("text"), str)
        and part["text"]
        and not part.get("thought")
    ]


_providers: dict[tuple[str, str, str | None], GeminiProvider] = {}
_providers_lock = threading.Lock()


def _cached_provider(api_key: str, model: str, fallback: str | None = None) -> GeminiProvider:
    # Sync dependencies run in a thread pool: one provider (one HTTP client) per
    # key/model/fallback.
    with _providers_lock:
        provider = _providers.get((api_key, model, fallback))
        if provider is None:
            provider = _providers[(api_key, model, fallback)] = GeminiProvider(
                api_key, model, fallback_model=fallback
            )
        return provider


def clear_provider_cache() -> None:
    with _providers_lock:
        _providers.clear()


def get_gemini_provider() -> GeminiProvider | None:
    """The shared Gemini provider, or None while GEMINI_API_KEY is not configured."""
    settings = get_settings()
    if settings.gemini_api_key is None:
        return None
    return _cached_provider(
        settings.gemini_api_key.get_secret_value(),
        settings.gemini_model,
        settings.gemini_fallback_model,
    )
