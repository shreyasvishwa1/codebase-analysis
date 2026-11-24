# Accuracy evaluation: security analysis compared with Semgrep

This page measures how accurately CodeBase Analysis finds security weaknesses, compared with
Semgrep, a widely used open-source static analyser. Every number below was produced by
`evaluation/run_evaluation.py`: Semgrep's on 2026-11-23, CodeBase Analysis's last on
2026-11-25. The figures for CodeBase Analysis are re-checked by the test suite on every push
(`backend/tests/test_evaluation.py`), so they stay true as the code changes.

## Tools compared

| Tool | Version | Configuration |
| --- | --- | --- |
| CodeBase Analysis | this repository | The security analysis exactly as an analysis run calls it: Bandit 1.9.4 for Python plus the app's own rules (JavaScript, React, configuration, Dockerfiles, `.env` files, secrets, and data flow from request input). |
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

When the corpus was written it included weakness types that CodeBase Analysis did not detect
at the time (path traversal, SSRF, open redirects and template injection), so that coverage
gaps would show up in the results. The data-flow checks added later cover them; see "Changes
after the first measurement".

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
| **CodeBase Analysis** | 60 | 7 | 5 | 0.896 | **0.923** | **0.909** | 2 / 47 |
| Bandit only | 22 | 7 | 43 | 0.759 | 0.338 | 0.468 | 2 / 47 |
| Own rules only | 38 | 0 | 27 | 1.000 | 0.585 | 0.738 | 0 / 47 |
| Semgrep (default) | 41 | 3 | 24 | **0.932** | 0.631 | 0.752 | 0 / 47 |
| Semgrep (extended) | 41 | 3 | 24 | 0.932 | 0.631 | 0.752 | 0 / 47 |
| CodeBase Analysis + Semgrep | 62 | 8 | 3 | 0.886 | 0.954 | 0.919 | 2 / 47 |

These numbers include changes that followed this benchmark, so the corpus no longer measures
CodeBase Analysis blind; see "Changes after the first measurement" below. How the app's
scores developed:

| Measurement | TP | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First measurement (pattern rules only) | 44 | 7 | 21 | 0.863 | 0.677 | 0.759 |
| After the two rule fixes | 46 | 7 | 19 | 0.868 | 0.708 | 0.780 |
| After adding the data-flow checks (current) | 60 | 7 | 5 | 0.896 | 0.923 | 0.909 |

Only the first row was measured before its authors had seen the results.

Detected cases per category (detected / cases):

| Category | Cases | CodeBase Analysis | Bandit only | Own rules only | Semgrep |
| --- | ---: | ---: | ---: | ---: | ---: |
| SQL injection | 5 | 5 | 3 | 2 | 3 |
| OS command injection | 5 | 5 | 3 | 2 | 5 |
| Code injection (eval, exec, new Function) | 5 | 5 | 2 | 3 | 4 |
| Cross-site scripting | 8 | 8 | 0 | 8 | 7 |
| Template injection | 1 | 1 | 0 | 1 | 1 |
| Path traversal | 4 | 4 | 0 | 4 | 2 |
| Server-side request forgery | 2 | 2 | 0 | 2 | 1 |
| Open redirect | 3 | 3 | 0 | 3 | 3 |
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

**Overall.** On this corpus CodeBase Analysis now has the higher recall (0.923 against 0.631)
and F1 (0.909 against 0.752). Semgrep is still more precise (0.932 against 0.896) and flags
none of the safe cases. Measured blind, before any change, the F1 scores were 0.759 and
0.752: too close to call. The current lead comes mostly from the data-flow checks, which were
written with this corpus known (see "Limitations"), so it should not be read as an
independent result.

**Own rules.** Added to Bandit, the app's own rules raise recall from 0.338 to 0.923 and add
no false positives. They cover what Bandit cannot see: JavaScript and React, configuration
files, Dockerfiles, committed `.env` files, secrets, and request input that reaches a file
path, a URL, a redirect, a template or an HTML response.

**Where Semgrep is stronger:**
- a JWT verified with the `none` algorithm allowed, and MD5 in JavaScript (the two cases
  only Semgrep finds);
- data flow across functions and files: its taint rules reach further than the app's checks,
  which stay within one Python function or one JavaScript file (see `dataflow.py`);
- precision, and a large maintained rule registry.

**Where CodeBase Analysis is stronger:**
- configuration and deployment weaknesses (CORS, `ALLOWED_HOSTS`, the `.env` file, unpinned
  images, `ADD` from a URL);
- hard-coded secrets in Python, Django settings and JavaScript (6 of 8 cases, Semgrep 2);
- XML parsing, temporary files and weak random in Python;
- path traversal and SSRF (4 of 4 and 2 of 2; Semgrep 2 and 1).

**False positives.** All seven of the app's false positives come from Bandit; none comes from
the app's own rules, including the data-flow checks. They are:
- three low-severity warnings on `import pickle`, `import subprocess` and `import xml.etree`;
- two warnings on `urlopen` with a function parameter (Semgrep reports the same two lines);
- one `random` call that only shuffles a display order;
- one `subprocess.run` with an argument list (B603 and B607 on the same line).

**Complementary.** Both tools find 39 of the same cases. Another 21 are found only by CodeBase
Analysis and 2 only by Semgrep. Together they reach 0.954 recall at 0.886 precision.

## Changes after the first measurement

The first run showed two gaps in the app's own rules. Both were general bugs, not features
missing for one case, so they were fixed. Later, the data-flow checks were added (item 3).

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

3. **Data-flow checks** (`app/analysis/security/dataflow.py`). Line rules cannot see request
   input reaching a dangerous call a few lines later, which is where Semgrep led. The new
   checks follow it within a Python function (Flask and Django request objects) or a
   JavaScript file (Express `req`, and the page's own address in the browser) into file
   paths (CWE-22), outgoing requests (CWE-918), redirects (CWE-601), templates (CWE-1336) and
   HTML responses (CWE-79). Sanitizers such as `secure_filename`, `os.path.basename`, `int`
   and HTML escaping clear a value. The checks found the 14 corpus cases of those kinds that
   were missed before, and no false positive. They come with 54 unit tests, including safe
   look-alikes and each stated limit, and were mutation-tested (22 of 22 meaningful mutants
   killed). Over every file in this repository and the sample archive they report nothing
   outside the corpus.

Because these changes followed this benchmark, its cases no longer measure them blind. That is
why every measurement is given here. The data-flow checks in particular were designed knowing
which flows the corpus contains; this corpus cannot show how well they do on code they were
not written for.

## Limitations

- **Author-built corpus.** The corpus was written by the authors of CodeBase Analysis, who
  knew its rules, and the later changes (above all the data-flow checks) were made after
  seeing it. The safe look-alikes limit this bias but cannot remove it. Only the first
  measurement (F1 0.759 against Semgrep's 0.752) was blind; an independent benchmark is
  stronger evidence.
- **Small corpus.** 65 vulnerable and 47 safe cases: a difference of a few cases moves the
  scores by several points.
- **Labelling choices.** The CWE groups and the seven rule overrides are judgment calls,
  listed in full in the script. Changing them changes the numbers.
- **Rule packs change.** Semgrep's registry packs are updated over time; the rules downloaded
  on another date may differ, even with the same Semgrep version.

## Future work

- Data flow across functions and files (the checks stay within one function or file).
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
