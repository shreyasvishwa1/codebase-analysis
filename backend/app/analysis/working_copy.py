"""A private working copy of a snapshot's Python files, for external analysis tools.

Tools such as Ruff and Bandit read files from disk. They are never pointed at repository
storage: they get this copy, which holds only the snapshot's verified, readable Python files
(already read through the verified reader), written under a temporary directory. Excluded
directories, links and the repository's own configuration files are never in it.

Several analyzers share one copy in a run; adding a file twice writes it once.
"""

from pathlib import Path, PurePosixPath


class PythonWorkingCopy:
    def __init__(self, workdir: Path) -> None:
        self.source = workdir / "src"
        self.source.mkdir(parents=True, exist_ok=True)
        self._written: dict[str, str] = {}  # casefolded copy path -> snapshot path

    def __len__(self) -> int:
        return len(self._written)

    def add(self, path: str, text: str) -> None:
        """Copy one file's text to the same relative path. Unsafe paths are skipped, and so
        is a path that differs only by letter case from one already copied."""
        parts = PurePosixPath(path).parts
        if not parts or ".." in parts or PurePosixPath(path).is_absolute():
            return
        key = path.casefold()
        if key in self._written:
            return
        target = self.source.joinpath(*parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8", newline="") as out:
            out.write(text)
        self._written[key] = path

    def snapshot_path(self, copy_path: str) -> str | None:
        """The snapshot path of a file a tool reported (relative to ``source``, '/'-separated)."""
        return self._written.get(copy_path.casefold())
