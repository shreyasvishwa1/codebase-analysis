"""Reading only the leading "info" object of PyPI's project document: the same latest version
as reading the whole document, without downloading every release."""

import json
from typing import Any

import httpx
import pytest

from app.analysis.dependencies import lookups

URL = "https://pypi.org/pypi/demo/json"


class Chunks(httpx.AsyncByteStream):
    """A response body delivered in the given chunks, recording how many were read."""

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.read = 0

    async def __aiter__(self):  # type: ignore[override]
        for chunk in self.chunks:
            self.read += 1
            yield chunk


def _document(version: str = "2.1.0", releases: int = 2000) -> dict[str, Any]:
    return {
        "info": {"name": "demo", "version": version, "summary": "Démo — ünïcode"},
        "last_serial": 1,
        "releases": {f"0.{n}": [{"filename": f"demo-0.{n}.tar.gz"}] for n in range(releases)},
        "urls": [],
    }


def _split(body: bytes, size: int) -> list[bytes]:
    return [body[i : i + size] for i in range(0, len(body), size)]


async def _read(stream: Chunks, status: int = 200, limit: int = lookups.MAX_REGISTRY_BYTES) -> Any:
    transport = httpx.MockTransport(lambda request: httpx.Response(status, stream=stream))
    async with httpx.AsyncClient(transport=transport) as client:
        return await lookups._pypi_info(client, URL, limit)


async def test_reading_stops_once_the_leading_info_has_arrived() -> None:
    body = json.dumps(_document()).encode()
    stream = Chunks(_split(body, 1024))
    data = await _read(stream)
    assert data == {"info": _document()["info"]}
    assert stream.read < len(stream.chunks) // 10  # most of the document is never read


async def test_the_version_is_the_one_the_whole_document_gives() -> None:
    body = json.dumps(_document("3.0.0rc1")).encode()
    assert (await _read(Chunks(_split(body, 7))))["info"]["version"] == "3.0.0rc1"
    assert json.loads(body)["info"]["version"] == "3.0.0rc1"


async def test_a_character_split_between_chunks_is_waited_for() -> None:
    body = json.dumps(_document(), ensure_ascii=False).encode("utf-8")
    cut = body.index("é".encode()) + 1  # inside the two bytes of "é"
    data = await _read(Chunks([body[:cut], body[cut:]]))
    assert data["info"]["summary"] == "Démo — ünïcode"


async def test_a_document_that_does_not_start_with_info_is_read_in_full() -> None:
    document = _document(releases=50)
    reordered = {"releases": document["releases"], "info": document["info"]}
    body = json.dumps(reordered).encode()
    stream = Chunks(_split(body, 256))
    assert await _read(stream) == reordered
    assert stream.read == len(stream.chunks)


async def test_an_info_object_that_never_completes_falls_back_to_the_whole_body() -> None:
    with pytest.raises(ValueError):  # invalid JSON, as before
        await _read(Chunks([b'{"info": {"version": "1.0"']))


async def test_missing_projects_errors_and_the_size_limit_behave_as_before() -> None:
    assert await _read(Chunks([b"{}"]), status=404) is None
    with pytest.raises(lookups._ResponseError):
        await _read(Chunks([b"{}"]), status=500)
    reordered = json.dumps({"releases": "x" * 5000, "info": {"version": "1"}}).encode()
    with pytest.raises(lookups._ResponseError):
        await _read(Chunks(_split(reordered, 1000)), limit=2000)


async def test_npm_keeps_reading_its_small_latest_document() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"version": "9.0.3"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await lookups._latest(client, "npm", "jsonwebtoken") == "9.0.3"
    assert seen == ["https://registry.npmjs.org/jsonwebtoken/latest"]
