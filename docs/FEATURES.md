# Feature reference

What each code-intelligence feature, diagnostic and repository analysis does, and where it stops. The [README](../README.md#key-features) has the overview.

## Code Intelligence

Python files only, on demand. Navigation follows imports across the repository's files, within
per-request budgets; results report any truncation.

| Feature | What it does | Scope |
| --- | --- | --- |
| Outline | Classes, functions and methods, each linked to its line | File |
| Imports / importers | Imports resolved to repository files; files that import this one | Cross-file |
| Go to definition | Resolves the selected name through Python's scope rules and imports | Cross-file |
| Find references | Uses of a function or class, each confirmed by resolving it; methods and nested classes are not supported | Cross-file |
| Name occurrences | Every occurrence of the same binding, not just the same spelling | File |
| Call hierarchy | Callers and callees; dynamic calls are counted, not guessed | Cross-file |
| Type hierarchy | Direct bases and direct subclasses | Cross-file |
| Method overrides | Methods this method directly overrides, and direct overrides of it | Cross-file |

There is no type inference: attribute uses such as `self.method()` or `obj.attr` are reported
as unsupported, never guessed.

Search:
- **Code search**: literal and case-insensitive; stops at 5,000 files, 64 MiB or 200 matches.
- **Symbol search**: exact, case-sensitive Python names, up to 200 results.

## Static Diagnostics

Each diagnostic analyzes one Python file and reports only what the syntax proves. Results
link to their lines and are capped at 500 per diagnostic, with exact counts. Files above
256 KiB are not parsed.

| Diagnostic | Reports | Deliberately conservative |
| --- | --- | --- |
| Unused imports | Import bindings whose name nothing in the file reads | Possible package or stub re-exports, dynamic access and string annotations are counted, not listed |
| Unbound names | Names read with no statically known binding | Not a runtime `NameError` detector |
| Unused variables | Assignments to function locals that nothing reads | Not a data-flow analysis |
| Redefined names | `def`, `async def` and `class` statements replaced by a later one of the same name before anything reads them | Decorated definitions, classes with bases, and dynamic scopes are counted only |
| Unreachable code | Statements after `return`, `raise`, `break` or `continue`, after an `if` whose every branch leaves, or after `while True:` without a `break` | Leaving through `try`, `with` or `match`, and calls that never return, are not inferred |

## Repository Analysis

- **Code metrics**: per-file line and blank-line counts. They are computed by a background job
  ("Analyze code") and stored for each snapshot.
- **Dependencies**: declared dependencies from up to 50 manifests (5,000 dependencies):
  - `package.json`;
  - `pyproject.toml` (the PEP 621 `[project]` table);
  - `requirements*.txt`.

  Nothing is resolved, installed or fetched.
- **Secret scan**: seven fixed rules covering AWS access key IDs; GitHub, Slack, Stripe live,
  Google API and Anthropic API keys; and private keys.
  - Findings carry the path, line and rule, never the matched text.
  - It stops at 5,000 files, 64 MiB or 500 findings.
- **Language statistics**: files and bytes per language.

## AI File Explanation

- Optional. Without a provider key, the endpoint answers 503 "AI explanations are not
  configured".
- Two providers:
  - **Anthropic** (paid): `ANTHROPIC_API_KEY`, model `LLM_MODEL` (default `claude-opus-5-5`),
    through the Messages API.
  - **Google Gemini** (free tier available): `GEMINI_API_KEY`, model `GEMINI_MODEL` (default
    `gemini-3.8-flash`), through `generateContent`. On the free tier, Google may use the content
    to improve its products, so use it only for code you are willing to share.
  - `LLM_PROVIDER` (`anthropic` or `gemini`) picks one. When it is unset, Anthropic is used if
    its key is set, otherwise Gemini.
- Sends the verified content of one file (at most 64 KiB) with a fixed server-side prompt and
  no tools. Only a complete answer is shown: blocked, safety-stopped or truncated responses are
  reported as errors.
- Limited to 20 explanations per user per hour. Review the provider's data-retention and
  privacy terms before enabling it.
