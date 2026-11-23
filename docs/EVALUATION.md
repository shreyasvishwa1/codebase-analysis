# Accuracy evaluation: security analysis compared with Semgrep

This page measures how accurately CodeBase Analysis finds security weaknesses, compared with
Semgrep, a widely used open-source static analyser. Every number below was produced by
`evaluation/run_evaluation.py` on 2026-11-23. The figures for CodeBase Analysis are re-checked
by the test suite on every push (`backend/tests/test_evaluation.py`), so they stay true as the
code changes.

## Tools compared

| Tool | Version | Configuration |
| --- | --- | --- |
| CodeBase Analysis | this repository | The security analysis exactly as an analysis run calls it: Bandit 1.9.4 for Python plus the app's own rules (JavaScript, React, configuration, Dockerfiles, `.env` files and secrets). |
| Bandit only | 1.9.4 | The Bandit part of the above, on its own. |
| Own rules only | this repository | The app's own rules, on their own. |
| Semgrep (default) | 1.184.0, Community Edition | `--config p/default`, metrics off. |
| Semgrep (extended) | 1.184.0, Community Edition | `p/default` plus `p/python`, `p/flask`, `p/django`, `p/javascript`, `p/nodejs`, `p/react`, `p/jwt`, `p/secrets`, `p/dockerfile` and `p/owasp-top-ten`. |

Dependency vulnerability lookups (CVE matching of `requirements.txt` and `package.json`) are
not part of this comparison: Semgrep Community Edition has no equivalent.

## Benchmark corpus

`evaluation/corpus.zip` holds 12 files written for this evaluation: a Flask service and its
background tasks, Django settings (unsafe and safe), an Express API, a browser script, a React
component, two Dockerfiles (unsafe and hardened), a committed `.env` and its `.env.example`,
and a private key.

It has **65 vulnerable cases and 47 safe cases** in 23 weakness categories, each tied to CWE
identifiers. Each case is one realistic line, labelled by a comment above it:
- `expect: <category>` marks a weakness;
- `safe: <category>` marks a safe look-alike, such as a parameterised query, `yaml.safe_load`,
  `textContent`, `subprocess.run` with a list, or `md5(..., usedforsecurity=False)`.

The corpus includes weakness types that CodeBase Analysis does not claim to detect, such as
path traversal, SSRF, open redirects and template injection, so that coverage gaps show up in
the results.

The corpus is zipped so that its deliberately vulnerable files are not scanned as part of this
repository. `evaluation/build_corpus.py` rebuilds the ZIP byte for byte from a folder.

## Method

A finding counts for a label only when all of the following hold:
- it is in the same file;
- it covers the labelled line, or, for a file-level label such as "no USER instruction", it is
  anywhere in that file;
- it reports the same kind of weakness. That means one of:
  - its CWE belongs to the label's category (`CATEGORY_CWES` in the script);
  - its rule is listed for that category in `RULE_CATEGORIES`, for the few rules whose CWE
    does not describe what they detect. Bandit files `eval` and `exec` under CWE-78 (OS command
    injection); Semgrep files its SQL injection rules under CWE-704 and CWE-915.

Each label counts once, however many rules report it.

Every finding that matches no `expect` label is a **false positive**, counted once per file and
line. It is also counted against a safe case when it falls on one.

**Manual review.** Every unmatched finding was read. One rule was applied to both tools alike:
a finding was added to the ground truth only if attacker-controlled input reaches it in the
code.
- **Added (3 cases):** Semgrep reported three places where request data is written
  unescaped into an HTML response. All three are genuine, so they were labelled XSS.
- **Kept as false positives:** findings with no such data flow, for both tools. These are:
  - Bandit's warnings on `import pickle` and `import subprocess`;
  - both tools' notes on `urlopen` with a function parameter;
  - Semgrep's CSRF-middleware note on an API that uses bearer tokens, not cookies;
  - Bandit's `random` warning where it only shuffles a display order.
- **Corrected in the corpus:** one case first used AWS's published example key, which Semgrep
  deliberately ignores; it was replaced with a realistic key of the same format.

Precision = TP / (TP + FP). Recall = TP / (TP + FN). F1 is their harmonic mean.

## Results

| Tool | TP | FP | FN | Precision | Recall | F1 | Safe cases flagged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **CodeBase Analysis** | 46 | 7 | 19 | 0.868 | **0.708** | **0.780** | 2 / 47 |
| Bandit only | 22 | 7 | 43 | 0.759 | 0.338 | 0.468 | 2 / 47 |
| Own rules only | 24 | 0 | 41 | 1.000 | 0.369 | 0.539 | 0 / 47 |
| Semgrep (default) | 41 | 3 | 24 | **0.932** | 0.631 | 0.752 | 0 / 47 |
| Semgrep (extended) | 41 | 3 | 24 | 0.932 | 0.631 | 0.752 | 0 / 47 |
| CodeBase Analysis + Semgrep | 59 | 8 | 6 | 0.881 | 0.908 | 0.894 | 2 / 47 |

These are the numbers after two rule fixes that this evaluation prompted; see "Changes after
the first measurement" below. The first measurement gave CodeBase Analysis 44 TP, 7 FP and
21 FN: precision 0.863, recall 0.677, F1 0.759.

Detected cases per category (detected / cases):

| Category | Cases | CodeBase Analysis | Bandit only | Own rules only | Semgrep |
| --- | ---: | ---: | ---: | ---: | ---: |
| SQL injection | 5 | 5 | 3 | 2 | 3 |
| OS command injection | 5 | 5 | 3 | 2 | 5 |
| Code injection (eval, exec, new Function) | 5 | 5 | 2 | 3 | 4 |
| Cross-site scripting | 8 | 4 | 0 | 4 | 7 |
| Template injection | 1 | 0 | 0 | 0 | 1 |
| Path traversal | 4 | 0 | 0 | 0 | 2 |
| Server-side request forgery | 2 | 0 | 0 | 0 | 1 |
| Open redirect | 3 | 0 | 0 | 0 | 3 |
| Insecure deserialization | 3 | 3 | 3 | 0 | 3 |
| XML external entities | 1 | 1 | 1 | 0 | 0 |
| Insecure temporary file | 1 | 1 | 1 | 0 | 0 |
| Weak hash | 3 | 2 | 2 | 0 | 3 |
| Weak random | 2 | 1 | 1 | 0 | 0 |
| TLS verification disabled | 3 | 3 | 2 | 1 | 3 |
| Insecure JWT | 2 | 1 | 0 | 1 | 2 |
| Hard-coded secrets and keys | 8 | 6 | 3 | 3 | 2 |
| Debug mode on | 2 | 2 | 1 | 1 | 1 |
| CORS allows every origin | 2 | 2 | 0 | 2 | 0 |
| Django `ALLOWED_HOSTS = ['*']` | 1 | 1 | 0 | 1 | 0 |
| Committed `.env` file | 1 | 1 | 0 | 1 | 0 |
| Container runs as root | 1 | 1 | 0 | 1 | 1 |
| Unpinned base image | 1 | 1 | 0 | 1 | 0 |
| `ADD` from a URL | 1 | 1 | 0 | 1 | 0 |

The extended Semgrep configuration adds one finding, a second report of an MD5 case the default
configuration already finds, so its scores equal the default configuration's.

## Discussion

**Overall.** On this corpus CodeBase Analysis has the higher recall (0.708 against 0.631)
and a higher F1 (0.780 against 0.752). Semgrep is more precise (0.932 against 0.868) and
flags none of the safe cases. Before the two rule fixes, the F1 scores were 0.759 and 0.752.

**Own rules.** The app's own rules more than double Bandit's recall (0.338 to 0.708) and add
no false positives. They cover what Bandit cannot see: JavaScript and React, configuration
files, Dockerfiles, committed `.env` files and secrets.

**Where Semgrep is stronger.** Its taint tracking follows request data into sinks, which finds
the weaknesses the app's line rules cannot:
- path traversal;
- SSRF;
- open redirects;
- template injection;
- reflected XSS in Express responses.

**Where CodeBase Analysis is stronger:**
- configuration and deployment weaknesses (CORS, `ALLOWED_HOSTS`, the `.env` file, unpinned
  images, `ADD` from a URL);
- hard-coded secrets in Python, Django settings and JavaScript (6 of 8 cases, Semgrep 2);
- XML parsing, temporary files and weak random in Python.

**False positives.** All seven of the app's false positives come from Bandit; none comes from
the app's own rules. They are:
- three low-severity warnings on `import pickle`, `import subprocess` and `import xml.etree`;
- two warnings on `urlopen` with a function parameter (Semgrep reports the same two lines);
- one `random` call that only shuffles a display order;
- one `subprocess.run` with an argument list (B603 and B607 on the same line).

**Complementary.** Both tools find 28 of the same cases. Another 18 are found only by CodeBase
Analysis and 13 only by Semgrep. Together they reach 0.908 recall at 0.881 precision, which
suggests running Semgrep alongside the app (see "Future work").

## Changes after the first measurement

The first run showed two gaps in the app's own rules. Both were general bugs, not features
missing for one case, so they were fixed. Every other result was left as measured.

1. **SQL injection in JavaScript.** The rule missed SQL in a string that also contains the
   other quote mark, the usual way a quoted value is concatenated:
   `"... WHERE name = '" + value + "'"`. Each quote style is now matched on its own.
2. **Hard-coded secrets.** The rule recognised `password = "..."` but not a name that ends in
   the word, such as `PAYMENT_API_SECRET`, `payment-api-key` or `myDbPassword`. Names in
   snake, kebab and camel case are now recognised. A name that only starts with the word, such
   as `passwordHint` or `SECRET_NAME`, is still not reported.

Each fix comes with unit tests for the new cases and for near-misses that must not match, and
was mutation-tested. Over every file in this repository, including both sample archives, the
fixes add three findings:
- the two corpus cases above;
- one password in a frontend test file, like two that were already reported.

Because these fixes followed this benchmark, its two cases no longer measure them blind. That
is why both the first and the current numbers are given here.

## Limitations

- **Author-built corpus.** The corpus was written by the authors of CodeBase Analysis, who
  knew its rules. The safe look-alikes and the categories outside the app's scope limit this
  bias, but it cannot be ruled out. An independent benchmark would be stronger evidence.
- **Small corpus.** 65 vulnerable and 47 safe cases: a difference of a few cases moves the
  scores by several points. The F1 scores (0.780 against 0.752, and 0.759 against 0.752
  before the fixes) are too close to call either tool better overall.
- **Labelling choices.** The CWE groups and the seven rule overrides are judgment calls,
  listed in full in the script. Changing them changes the numbers.
- **Rule packs change.** Semgrep's registry packs are updated over time; the rules downloaded
  on another date may differ, even with the same Semgrep version.

## Future work

- Data-flow (taint) analysis from request inputs, for path traversal, SSRF and open redirects.
- Each secret inside a committed `.env` file (the app reports the file itself, but not each
  value in it).
- Weak random in JavaScript (`Math.random()` used for a token).
- Optionally running Semgrep inside an analysis, as Bandit runs today.

## Reproducing

Requirements: the backend's virtual environment (for the app and Bandit), and Docker, or
`semgrep` on the PATH. From the repository root:

```bash
backend/.venv/bin/python evaluation/run_evaluation.py     # Linux / macOS
backend\.venv\Scripts\python evaluation\run_evaluation.py  # Windows
```

The script writes `evaluation/results/summary.json`, which lists every detected, missed and
false-positive case per tool, and Semgrep's raw reports next to it. To re-score saved reports
without running Semgrep again, add
`--semgrep-json semgrep-default=evaluation/results/semgrep-default.json` and
`--semgrep-json semgrep-extended=evaluation/results/semgrep-extended.json`.
