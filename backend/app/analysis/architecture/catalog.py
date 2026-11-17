"""What well-known packages are: frameworks, libraries and data-store drivers.

A technology is reported only with evidence: a manifest declaration (file and line) or an
import of the package in the code. Packages that are not in this table are not reported as
technologies (they still appear in the dependency analysis).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Technology:
    name: str
    category: str  # backend, frontend, database, orm, testing, build, queue, styling, state, http


_PYTHON: dict[str, Technology] = {
    "django": Technology("Django", "backend"),
    "flask": Technology("Flask", "backend"),
    "fastapi": Technology("FastAPI", "backend"),
    "starlette": Technology("Starlette", "backend"),
    "tornado": Technology("Tornado", "backend"),
    "aiohttp": Technology("aiohttp", "backend"),
    "sanic": Technology("Sanic", "backend"),
    "streamlit": Technology("Streamlit", "frontend"),
    "sqlalchemy": Technology("SQLAlchemy", "orm"),
    "alembic": Technology("Alembic", "orm"),
    "peewee": Technology("peewee", "orm"),
    "tortoise-orm": Technology("Tortoise ORM", "orm"),
    "psycopg2": Technology("PostgreSQL", "database"),
    "psycopg2-binary": Technology("PostgreSQL", "database"),
    "psycopg": Technology("PostgreSQL", "database"),
    "asyncpg": Technology("PostgreSQL", "database"),
    "pymysql": Technology("MySQL", "database"),
    "mysqlclient": Technology("MySQL", "database"),
    "pymongo": Technology("MongoDB", "database"),
    "motor": Technology("MongoDB", "database"),
    "redis": Technology("Redis", "database"),
    "elasticsearch": Technology("Elasticsearch", "database"),
    "celery": Technology("Celery", "queue"),
    "arq": Technology("arq", "queue"),
    "rq": Technology("RQ", "queue"),
    "pytest": Technology("pytest", "testing"),
    "pydantic": Technology("Pydantic", "backend"),
    "requests": Technology("Requests", "http"),
    "httpx": Technology("HTTPX", "http"),
}

_NPM: dict[str, Technology] = {
    "react": Technology("React", "frontend"),
    "react-dom": Technology("React", "frontend"),
    "next": Technology("Next.js", "frontend"),
    "vue": Technology("Vue", "frontend"),
    "nuxt": Technology("Nuxt", "frontend"),
    "svelte": Technology("Svelte", "frontend"),
    "@sveltejs/kit": Technology("SvelteKit", "frontend"),
    "@angular/core": Technology("Angular", "frontend"),
    "solid-js": Technology("Solid", "frontend"),
    "express": Technology("Express", "backend"),
    "koa": Technology("Koa", "backend"),
    "fastify": Technology("Fastify", "backend"),
    "@nestjs/core": Technology("NestJS", "backend"),
    "hapi": Technology("hapi", "backend"),
    "@hapi/hapi": Technology("hapi", "backend"),
    "prisma": Technology("Prisma", "orm"),
    "@prisma/client": Technology("Prisma", "orm"),
    "sequelize": Technology("Sequelize", "orm"),
    "typeorm": Technology("TypeORM", "orm"),
    "mongoose": Technology("MongoDB", "database"),
    "mongodb": Technology("MongoDB", "database"),
    "pg": Technology("PostgreSQL", "database"),
    "mysql": Technology("MySQL", "database"),
    "mysql2": Technology("MySQL", "database"),
    "sqlite3": Technology("SQLite", "database"),
    "better-sqlite3": Technology("SQLite", "database"),
    "redis": Technology("Redis", "database"),
    "ioredis": Technology("Redis", "database"),
    "bull": Technology("Bull", "queue"),
    "bullmq": Technology("BullMQ", "queue"),
    "jest": Technology("Jest", "testing"),
    "vitest": Technology("Vitest", "testing"),
    "mocha": Technology("Mocha", "testing"),
    "cypress": Technology("Cypress", "testing"),
    "@playwright/test": Technology("Playwright", "testing"),
    "vite": Technology("Vite", "build"),
    "webpack": Technology("webpack", "build"),
    "typescript": Technology("TypeScript", "build"),
    "tailwindcss": Technology("Tailwind CSS", "styling"),
    "redux": Technology("Redux", "state"),
    "@reduxjs/toolkit": Technology("Redux", "state"),
    "zustand": Technology("Zustand", "state"),
    "@tanstack/react-query": Technology("TanStack Query", "state"),
    "axios": Technology("Axios", "http"),
}

# Python import names that differ from their distribution names.
_PYTHON_IMPORTS = {"MySQLdb": "mysqlclient"}

# Docker image names (without registry, tag) that are data stores or brokers.
DATA_STORE_IMAGES: dict[str, str] = {
    "postgres": "PostgreSQL",
    "postgis/postgis": "PostgreSQL",
    "mysql": "MySQL",
    "mariadb": "MySQL",
    "mongo": "MongoDB",
    "redis": "Redis",
    "valkey/valkey": "Redis",
    "elasticsearch": "Elasticsearch",
    "rabbitmq": "RabbitMQ",
    "memcached": "Memcached",
}

CATEGORY_ORDER = (
    "backend", "frontend", "orm", "database", "queue", "state", "http", "styling", "build", "testing",
)  # fmt: skip


def technology(ecosystem: str, package: str) -> Technology | None:
    """The technology a declared or imported package is, if it is a known one."""
    table = _PYTHON if ecosystem == "python" else _NPM
    return table.get(package.lower())


def python_import_package(module: str) -> str:
    """The distribution most likely providing an imported top-level module."""
    top = module.split(".", 1)[0]
    return _PYTHON_IMPORTS.get(top, top).lower()


def npm_import_package(specifier: str) -> str | None:
    """The package of a bare JavaScript import specifier (``react-dom/client`` -> react-dom);
    None for relative paths, URLs, Node built-ins and aliases."""
    if specifier.startswith(
        (".", "/", "~", "#", "node:", "http:", "https:")
    ) or specifier.startswith("@/"):
        return None
    parts = specifier.split("/")
    if specifier.startswith("@"):
        return "/".join(parts[:2]) if len(parts) >= 2 else None
    return parts[0] or None


def image_data_store(image: str) -> str | None:
    """The data store a Docker image is (``postgres:16-alpine`` -> PostgreSQL)."""
    name = image.split("@", 1)[0]  # no digest
    head, _, last = name.rpartition("/")
    last = last.split(":", 1)[0]  # no tag
    name = f"{head}/{last}" if head else last
    for prefix in ("docker.io/library/", "docker.io/", "library/"):
        name = name.removeprefix(prefix)
    return DATA_STORE_IMAGES.get(name.lower())
