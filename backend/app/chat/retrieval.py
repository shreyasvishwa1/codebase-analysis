"""Finding the code passages that answer a question.

The question is split into search terms with the tokenizer that indexed the chunks
(app.analysis.chunks.words), so ``getUserName`` in a question finds ``get_user_name`` in the
code. Common English words are dropped. The terms form an OR query, with prefix matching for
terms of four characters or more (``route`` finds ``routes``); terms contain only ``a-z`` and
digits, so no query syntax can be injected. Chunks are ranked with ``ts_rank_cd`` (path and
symbol matches count more than body matches), at most MAX_PER_FILE per file. Files the
question names (``auth.py``, ``src/api/client.ts``) come first.
"""

import re
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.chunks import words
from app.analysis.results import escape_like
from app.models import CodeChunk

MAX_TERMS = 24
MAX_PASSAGES = 8
MAX_PER_FILE = 3
CANDIDATES = 60
MAX_CONTEXT_CHARS = 36000  # passages sent to the model, in total
MAX_NAMED_FILES = 3
NAMED_FILE_CHUNKS = 2

RANK_NORMALIZATION = 0  # ts_rank_cd: no length normalization (substantial chunks rank higher)
TEST_WEIGHT = 0.4  # rank factor for test files, unless the question is about tests
TEST_PATH = r"(^|/)(tests?|__tests__|spec|specs)/|(^|/)test_[^/]*$|[._-](test|spec)\.[a-z]+$"
TESTS_ASKED = re.compile(r"\b(tests?|tested|testing|specs?|coverage)\b", re.I)

_TERM = re.compile(r"[a-z0-9]+")
_FILE_NAME = re.compile(r"[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z0-9]{1,8}\b")

STOPWORDS = frozenset(
    """
    a about above after again all also am an and any are as at be because been before being
    below between both but by can could did do does doing done down during each else ever few
    for from further get gets got had has have having he her here hers him his how however if
    in into is it its itself just let like make me might more most much must my no nor not now
    of off on once only or other our out over own please same say see she should show so some
    such tell than that the their theirs them then there these they this those through to too
    under until up us use used uses using very want was way we were what when where which
    while who whom why will with within without would yes yet you your yours
    code file files function functions project repository repo work works
    """.split()
)


@dataclass(frozen=True)
class Passage:
    n: int  # 1-based number cited in the answer as [n]
    path: str
    start_line: int
    end_line: int
    symbol: str | None
    content: str

    def citation(self) -> dict[str, object]:
        return {
            "n": self.n,
            "path": self.path,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "symbol": self.symbol,
        }


def query_terms(text: str) -> list[str]:
    """Distinct search terms of ``text``, in order, without stopwords."""
    found: dict[str, None] = {}
    for word in words(text):
        if word in STOPWORDS or not _TERM.fullmatch(word) or word in found:
            continue
        found[word] = None
        if len(found) == MAX_TERMS:
            break
    return list(found)


def _stem(term: str) -> str:
    """A prefix that also matches other forms of the word (``users`` -> ``user``,
    ``dependencies`` -> ``dependenc``, ``classes`` -> ``class``, ``hashed`` and ``hashing``
    -> ``hash``)."""
    if len(term) >= 7 and term.endswith("ing"):
        return term[:-3]
    if len(term) >= 6 and term.endswith("ed") and not term.endswith("eed"):
        return term[:-2]
    if len(term) >= 6 and term.endswith("ies"):
        return term[:-3]
    if len(term) >= 6 and term.endswith(("ses", "xes", "ches", "shes")):
        return term[:-2]
    if len(term) >= 5 and term.endswith("s") and not term.endswith("ss"):
        return term[:-1]
    return term


def tsquery(terms: list[str]) -> str:
    return " | ".join(f"{_stem(term)}:*" if len(term) >= 4 else term for term in terms)


def named_files(text: str) -> list[str]:
    """File names or paths the question mentions (``auth.py``, ``src/api/client.ts``)."""
    names: dict[str, None] = {}
    for match in _FILE_NAME.findall(text):
        name = match.strip("./")
        stem, _, extension = name.rpartition(".")
        base = stem.rsplit("/", 1)[-1]
        if len(base) >= 2 and any(c.isalpha() for c in extension):
            names[name] = None
    return list(names)[:MAX_NAMED_FILES]


@dataclass(frozen=True)
class Retrieval:
    passages: list[Passage]
    missing_files: list[str]  # files the question names that are not in the analysis


async def retrieve(db: AsyncSession, run_id: uuid.UUID, text: str) -> Retrieval:
    """The passages of the run that best match ``text``, numbered from 1."""
    rows: list[CodeChunk] = []
    missing: list[str] = []
    for name in named_files(text):
        pattern = "%/" + escape_like(name)
        named = await db.scalars(
            select(CodeChunk)
            .where(
                CodeChunk.run_id == run_id,
                or_(CodeChunk.path == name, CodeChunk.path.like(pattern, escape="\\")),
            )
            .order_by(CodeChunk.path, CodeChunk.start_line)
            .limit(NAMED_FILE_CHUNKS)
        )
        found = list(named)
        if not found:
            missing.append(name)
        rows.extend(found)
    terms = query_terms(text)
    if terms:
        query = func.to_tsquery("simple", tsquery(terms))
        rank: ColumnElement[Any] = func.ts_rank_cd(CodeChunk.search, query, RANK_NORMALIZATION)
        if not TESTS_ASKED.search(text):
            # Questions about how something works are answered by the code, not its tests.
            rank = rank * case((CodeChunk.path.regexp_match(TEST_PATH), TEST_WEIGHT), else_=1.0)
        ranked = await db.scalars(
            select(CodeChunk)
            .where(CodeChunk.run_id == run_id, CodeChunk.search.op("@@")(query))
            .order_by(rank.desc(), CodeChunk.path, CodeChunk.start_line)
            .limit(CANDIDATES)
        )
        rows.extend(ranked)
    passages: list[Passage] = []
    seen: set[uuid.UUID] = set()
    per_file: dict[str, int] = {}
    size = 0
    for row in rows:
        if row.id in seen or per_file.get(row.path, 0) >= MAX_PER_FILE:
            continue
        if size + len(row.content) > MAX_CONTEXT_CHARS:
            continue
        seen.add(row.id)
        per_file[row.path] = per_file.get(row.path, 0) + 1
        size += len(row.content)
        passages.append(
            Passage(
                len(passages) + 1, row.path, row.start_line, row.end_line, row.symbol, row.content
            )
        )
        if len(passages) == MAX_PASSAGES:
            break
    return Retrieval(passages, missing)
