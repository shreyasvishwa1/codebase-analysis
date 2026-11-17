"""Paths that a full analysis never measures.

Dependency folders, build output, caches and virtual environments are not the project's own
code; including them would drown real findings. Generated files (minified bundles and lock
files) are excluded from code measurements as well, though later analyzers may still read
lock files for dependency information.
"""

from pathlib import PurePosixPath

EXCLUDED_DIRECTORIES = frozenset(
    {
        "node_modules",
        "bower_components",
        "vendor",
        ".git",
        ".hg",
        ".svn",
        "dist",
        "build",
        ".next",
        ".nuxt",
        ".svelte-kit",
        "coverage",
        "htmlcov",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        "venv",
        "env",
        ".idea",
        ".vscode",
    }
)

LOCK_FILES = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "Pipfile.lock",
        "composer.lock",
        "Cargo.lock",
        "Gemfile.lock",
        "go.sum",
    }
)

GENERATED_SUFFIXES = (".min.js", ".min.css", ".map", ".bundle.js")


def excluded_directory(path: str) -> str | None:
    """The excluded directory a repository path lies in, or None."""
    for part in PurePosixPath(path).parts[:-1]:
        if part in EXCLUDED_DIRECTORIES:
            return part
    return None


def is_generated(path: str) -> bool:
    """Lock files and minified or bundled output, which are not hand-written code."""
    name = PurePosixPath(path).name
    return name in LOCK_FILES or name.endswith(GENERATED_SUFFIXES)
