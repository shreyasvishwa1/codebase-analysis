"""Gemini provider and provider selection tests (no database, no Redis, no network).

Requests are intercepted with respx; nothing reaches Google.
"""

import json
from typing import Any

import httpx
import pytest
import respx
from pydantic import SecretStr, ValidationError

from app.ai import anthropic_provider, gemini_provider, selection
from app.ai.anthropic_provider import AnthropicProvider
from app.ai.gemini_provider import (
    API_BASE_URL,
    DECLINED,
    INCOMPLETE,
    TEMPERATURE_UNSUPPORTED,
    UNAVAILABLE,
    GeminiProvider,
    get_gemini_provider,
)
from app.ai.provider import ChatMessage, LLMProviderError
from app.config import Settings, get_settings

TEST_KEY = "test-only-gemini-key-0000"  # not a real credential
MODEL = "gemini-3.8-flash"
URL = f"{API_BASE_URL}/v1beta/models/{MODEL}:generateContent"
MESSAGES = [ChatMessage(role="user", content="Explain <file>x</file>")]
SECRET_MARKER = "secret-response-detail"


def _response(
    parts: list[dict[str, Any]] | None = None,
    finish: str | None = "STOP",
    usage: dict[str, Any] | None = None,
    model: str | None = "gemini-3.8-flash-001",
) -> dict[str, Any]:
    candidate: dict[str, Any] = {"content": {"role": "model", "parts": parts or [{"text": "ok"}]}}
    if finish is not None:
        candidate["finishReason"] = finish
    data: dict[str, Any] = {
        "candidates": [candidate],
        "usageMetadata": usage
        if usage is not None
        else {"promptTokenCount": 120, "candidatesTokenCount": 45},
    }
    if model is not None:
        data["modelVersion"] = model
    return data


@pytest.fixture(autouse=True)
def _fresh_provider_caches() -> Any:
    gemini_provider.clear_provider_cache()
    anthropic_provider.clear_provider_cache()
    yield
    gemini_provider.clear_provider_cache()
    anthropic_provider.clear_provider_cache()


@pytest.fixture
def api() -> Any:
    with respx.mock(assert_all_called=False) as mock:
        yield mock


# --- Request construction ----------------------------------------------------------------


async def test_exact_request(api: respx.MockRouter) -> None:
    route = api.post(URL).respond(200, json=_response())
    await GeminiProvider(TEST_KEY, MODEL).generate(
        MESSAGES, system="fixed system", max_tokens=16000
    )
    request = route.calls.last.request
    assert str(request.url) == URL  # no key or other query parameters in the URL
    assert TEST_KEY not in str(request.url)
    assert request.headers["x-goog-api-key"] == TEST_KEY
    assert json.loads(request.content) == {
        "contents": [{"role": "user", "parts": [{"text": "Explain <file>x</file>"}]}],
        "generationConfig": {"maxOutputTokens": 16000},
        "systemInstruction": {"parts": [{"text": "fixed system"}]},
    }


async def test_system_is_omitted_and_assistant_turns_map_to_model(api: respx.MockRouter) -> None:
    route = api.post(URL).respond(200, json=_response())
    conversation = [
        *MESSAGES,
        ChatMessage(role="assistant", content="Sure"),
        ChatMessage(role="user", content="More"),
    ]
    await GeminiProvider(TEST_KEY, MODEL).generate(conversation, max_tokens=100)
    body = json.loads(route.calls.last.request.content)
    assert "systemInstruction" not in body
    assert [turn["role"] for turn in body["contents"]] == ["user", "model", "user"]
    assert "tools" not in body and "safetySettings" not in body


async def test_temperature_is_rejected_without_a_call(api: respx.MockRouter) -> None:
    route = api.post(URL).respond(200, json=_response())
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10, temperature=0.2)
    assert str(raised.value) == TEMPERATURE_UNSUPPORTED
    assert not route.called


# --- Response handling -------------------------------------------------------------------


async def test_text_parts_are_joined_and_thoughts_ignored(api: respx.MockRouter) -> None:
    parts = [
        {"text": "thinking...", "thought": True},
        {"text": "Hello "},
        {"inlineData": {"mimeType": "image/png", "data": ""}},
        {"text": "world"},
    ]
    api.post(URL).respond(200, json=_response(parts=parts))
    result = await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert result.text == "Hello world"
    assert result.model == "gemini-3.8-flash-001"
    assert (result.input_tokens, result.output_tokens) == (120, 45)


async def test_missing_model_and_usage_fall_back_safely(api: respx.MockRouter) -> None:
    api.post(URL).respond(
        200,
        json=_response(model=None, usage={"promptTokenCount": "12", "candidatesTokenCount": True}),
    )
    result = await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert result.model == MODEL
    assert (result.input_tokens, result.output_tokens) == (None, None)


@pytest.mark.parametrize(
    ("finish", "message"),
    [
        ("MAX_TOKENS", INCOMPLETE),
        ("CONTINUATION", INCOMPLETE),
        ("SAFETY", DECLINED),
        ("RECITATION", DECLINED),
        ("PROHIBITED_CONTENT", DECLINED),
        ("OTHER", DECLINED),
        (None, DECLINED),
    ],
)
async def test_only_a_natural_stop_is_an_answer(
    api: respx.MockRouter, finish: str | None, message: str
) -> None:
    api.post(URL).respond(200, json=_response(parts=[{"text": "partial answer"}], finish=finish))
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == message


async def test_blocked_prompt_is_declined(api: respx.MockRouter) -> None:
    api.post(URL).respond(200, json={"promptFeedback": {"blockReason": "SAFETY"}, **_response()})
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == DECLINED


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"candidates": []},
        {"candidates": "x"},
        {"candidates": ["x"]},
        {"candidates": [{"finishReason": "STOP"}]},
        {"candidates": [{"finishReason": "STOP", "content": {"parts": "x"}}]},
    ],
)
async def test_unexpected_shapes_are_unavailable(api: respx.MockRouter, payload: Any) -> None:
    api.post(URL).respond(200, json=payload)
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE


@pytest.mark.parametrize("status", [201, 400, 403, 404, 429, 500, 503])
async def test_error_statuses_are_unavailable_without_details(
    api: respx.MockRouter, status: int
) -> None:
    api.post(URL).respond(status, json={"error": {"message": SECRET_MARKER}})
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE
    assert raised.value.__cause__ is None
    assert SECRET_MARKER not in repr(raised.value) and TEST_KEY not in repr(raised.value)


async def test_only_200_is_accepted_even_with_an_answer_body(api: respx.MockRouter) -> None:
    api.post(URL).respond(203, json=_response(parts=[{"text": "from a proxy"}]))
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE


async def test_invalid_json_and_transport_errors_are_unavailable(api: respx.MockRouter) -> None:
    api.post(URL).respond(200, content=b"not json")
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE and raised.value.__cause__ is None

    api.post(URL).mock(side_effect=httpx.ConnectError(f"boom {TEST_KEY}"))
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE
    assert raised.value.__cause__ is None and TEST_KEY not in repr(raised.value)


async def test_redirects_are_not_followed(api: respx.MockRouter) -> None:
    elsewhere = api.post("https://attacker.example/collect").respond(200, json=_response())
    api.post(URL).respond(307, headers={"location": "https://attacker.example/collect"})
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL).generate(MESSAGES, max_tokens=10)
    assert str(raised.value) == UNAVAILABLE
    assert not elsewhere.called  # the key never leaves for another host


async def test_generate_stream_yields_the_validated_answer(api: respx.MockRouter) -> None:
    api.post(URL).respond(200, json=_response(parts=[{"text": "streamed"}]))
    chunks = [
        c async for c in GeminiProvider(TEST_KEY, MODEL).generate_stream(MESSAGES, max_tokens=10)
    ]
    assert chunks == ["streamed"]
    api.post(URL).respond(200, json=_response(finish="SAFETY"))
    with pytest.raises(LLMProviderError):
        async for _ in GeminiProvider(TEST_KEY, MODEL).generate_stream(MESSAGES, max_tokens=10):
            pass


# --- Real client and caching ---------------------------------------------------------------


def test_real_client_is_explicit() -> None:
    client = GeminiProvider(TEST_KEY, MODEL)._client
    assert (
        str(client.base_url).rstrip("/")
        == API_BASE_URL
        == "https://generativelanguage.googleapis.com"
    )
    assert client.headers["x-goog-api-key"] == TEST_KEY
    assert client.follow_redirects is False
    assert client.timeout == httpx.Timeout(60.0)


def test_no_key_means_no_provider_and_no_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "gemini_api_key", None)

    def no_client(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("no client may be created without a key")

    monkeypatch.setattr(gemini_provider, "GeminiProvider", no_client)
    monkeypatch.setenv("GEMINI_API_KEY", "ambient-key-must-not-enable-the-feature")
    assert get_gemini_provider() is None


def test_provider_is_cached_per_key_and_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "gemini_api_key", SecretStr(TEST_KEY))
    first = get_gemini_provider()
    assert isinstance(first, GeminiProvider)
    assert get_gemini_provider() is first
    monkeypatch.setattr(get_settings(), "gemini_model", "gemini-3.5-flash-lite")
    assert get_gemini_provider() is not first  # a new model gets a new provider


# --- Selection -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("choice", "anthropic_key", "gemini_key", "expected"),
    [
        (None, "a-key", "g-key", AnthropicProvider),  # Anthropic first when both are set
        (None, None, "g-key", GeminiProvider),
        (None, "a-key", None, AnthropicProvider),
        (None, None, None, None),
        ("gemini", "a-key", "g-key", GeminiProvider),
        ("gemini", "a-key", None, None),  # no silent fallback to the other provider
        ("anthropic", None, "g-key", None),
        ("anthropic", "a-key", None, AnthropicProvider),
    ],
)
def test_selection(
    monkeypatch: pytest.MonkeyPatch,
    choice: str | None,
    anthropic_key: str | None,
    gemini_key: str | None,
    expected: type | None,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", choice)
    monkeypatch.setattr(
        settings, "anthropic_api_key", SecretStr(anthropic_key) if anthropic_key else None
    )
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr(gemini_key) if gemini_key else None)
    provider = selection.get_llm_provider()
    if expected is None:
        assert provider is None
    else:
        assert isinstance(provider, expected)


def test_settings_validate_provider_key_and_model() -> None:
    base = {"_env_file": None, "secret_key": "x" * 40}
    assert Settings(**base).llm_provider is None  # type: ignore[arg-type]
    assert Settings(**base, llm_provider="").llm_provider is None  # type: ignore[arg-type]
    assert Settings(**base, llm_provider=" Gemini ").llm_provider == "gemini"  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        Settings(**base, llm_provider="openai")  # type: ignore[arg-type]
    assert Settings(**base, gemini_api_key="  ").gemini_api_key is None  # type: ignore[arg-type]
    configured = Settings(**base, gemini_api_key=TEST_KEY)  # type: ignore[arg-type]
    assert TEST_KEY not in repr(configured)  # SecretStr
    assert Settings(**base).gemini_model == "gemini-3.8-flash"  # type: ignore[arg-type]
    assert (
        Settings(**base, gemini_model=" gemini-3.5-flash-lite ").gemini_model
        == "gemini-3.5-flash-lite"
    )  # type: ignore[arg-type]
    for bad in ("", "  ", "../x", "models/x", "x?key=1", "-x", "gémini", "a b", ".hidden"):
        with pytest.raises(ValidationError):
            Settings(**base, gemini_model=bad)  # type: ignore[arg-type]


def test_settings_validate_the_fallback_model() -> None:
    base = {"_env_file": None, "secret_key": "x" * 40}
    assert Settings(**base).gemini_fallback_model == "gemini-3.5-flash-lite"  # type: ignore[arg-type]
    for empty in ("", "   "):
        assert Settings(**base, gemini_fallback_model=empty).gemini_fallback_model is None  # type: ignore[arg-type]
    assert Settings(**base, gemini_fallback_model=" gemini-x ").gemini_fallback_model == "gemini-x"  # type: ignore[arg-type]
    for bad in ("../x", "models/x", "x?key=1", "-x", "a b"):
        with pytest.raises(ValidationError):
            Settings(**base, gemini_fallback_model=bad)  # type: ignore[arg-type]


# --- Busy models: retries and the fallback ------------------------------------------------

FALLBACK = "gemini-3.5-flash-lite"
FALLBACK_URL = f"{API_BASE_URL}/v1beta/models/{FALLBACK}:generateContent"


@pytest.fixture(autouse=True)
def _no_retry_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gemini_provider, "RETRY_DELAYS", (0.0, 0.0))


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
async def test_a_busy_model_is_retried(api: respx.MockRouter, status: int) -> None:
    route = api.post(URL)
    route.side_effect = [
        httpx.Response(status, json={"error": {"status": "UNAVAILABLE"}}),
        httpx.Response(200, json=_response(parts=[{"text": "second try"}])),
    ]
    result = await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
        MESSAGES, max_tokens=10
    )
    assert result.text == "second try"
    assert route.call_count == 2


async def test_retries_wait_before_each_attempt(
    api: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    waits: list[float] = []

    async def record(delay: float) -> None:
        waits.append(delay)

    monkeypatch.setattr(gemini_provider, "RETRY_DELAYS", (1.0, 3.0))
    monkeypatch.setattr(gemini_provider.asyncio, "sleep", record)
    api.post(URL).respond(503)
    api.post(FALLBACK_URL).respond(200, json=_response(parts=[{"text": "fallback"}], model=None))
    result = await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
        MESSAGES, max_tokens=10
    )
    assert waits == [1.0, 3.0]
    assert (result.text, result.model) == ("fallback", FALLBACK)  # the model that answered


async def test_a_model_still_busy_hands_over_to_the_fallback(api: respx.MockRouter) -> None:
    primary = api.post(URL).respond(503)
    fallback = api.post(FALLBACK_URL).respond(
        200, json=_response(parts=[{"text": "from the fallback"}])
    )
    result = await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
        MESSAGES, max_tokens=10
    )
    assert result.text == "from the fallback"
    assert (primary.call_count, fallback.call_count) == (3, 1)
    body = json.loads(fallback.calls[0].request.content)
    assert body == json.loads(primary.calls[0].request.content)  # the same request


async def test_both_models_busy_is_unavailable(api: respx.MockRouter) -> None:
    primary = api.post(URL).respond(503)
    fallback = api.post(FALLBACK_URL).respond(429)
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
            MESSAGES, max_tokens=10
        )
    assert str(raised.value) == UNAVAILABLE
    assert (primary.call_count, fallback.call_count) == (3, 1)


async def test_a_timeout_goes_straight_to_the_fallback(api: respx.MockRouter) -> None:
    primary = api.post(URL).mock(side_effect=httpx.ReadTimeout("slow"))
    fallback = api.post(FALLBACK_URL).respond(200, json=_response())
    await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(MESSAGES, max_tokens=10)
    assert (primary.call_count, fallback.call_count) == (1, 1)
    fallback.mock(side_effect=httpx.ReadTimeout("slow too"))
    with pytest.raises(LLMProviderError) as raised:
        await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
            MESSAGES, max_tokens=10
        )
    assert str(raised.value) == UNAVAILABLE and raised.value.__cause__ is None


@pytest.mark.parametrize("status", [400, 403, 404])
async def test_other_errors_are_not_retried(api: respx.MockRouter, status: int) -> None:
    primary = api.post(URL).respond(status)
    fallback = api.post(FALLBACK_URL).respond(200, json=_response())
    with pytest.raises(LLMProviderError):
        await GeminiProvider(TEST_KEY, MODEL, fallback_model=FALLBACK).generate(
            MESSAGES, max_tokens=10
        )
    assert (primary.call_count, fallback.called) == (1, False)


async def test_without_a_fallback_only_the_model_is_retried(api: respx.MockRouter) -> None:
    primary = api.post(URL).respond(503)
    for provider in (
        GeminiProvider(TEST_KEY, MODEL),
        GeminiProvider(TEST_KEY, MODEL, fallback_model=MODEL),
    ):
        primary.reset()
        with pytest.raises(LLMProviderError):
            await provider.generate(MESSAGES, max_tokens=10)
        assert primary.call_count == 3  # a fallback equal to the model is no fallback


def test_provider_is_cached_per_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr(TEST_KEY))
    monkeypatch.setattr(settings, "gemini_fallback_model", FALLBACK)
    first = get_gemini_provider()
    assert first is not None and first._fallback == FALLBACK
    monkeypatch.setattr(settings, "gemini_fallback_model", None)
    second = get_gemini_provider()
    assert second is not first and second is not None and second._fallback is None
