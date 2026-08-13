# Dependency audit — recorded decisions

Last reviewed **2026-08-13** against `npm audit --omit=dev` in `widget/`.

`npm audit` reports advisories against packages, not against *how this app uses them*. Some of
what it reports cannot fire here. This file records which, and why, so nobody re-litigates it —
or worse, "fixes" something at the cost of a working feature.

**Standing rule:** never run `npm audit fix --force` on this repo. It applies semver-major
changes, and at least one of those (see exceljs) would downgrade a working library to silence an
advisory that cannot fire.

---

## Fixed — 2026-08-13

| Package | Was → Now | Advisory |
|---|---|---|
| `js-yaml` (via `electron-updater`) | 4.3.0 → **4.3.1** | Quadratic CPU consumption in `!!omap` resolution (CVE-2026-59870) |
| `nanoid` (via `docx`) | 5.1.6 → **5.1.16** | Non-secure generators can loop indefinitely with negative size |

Applied with plain `npm audit fix` (no `--force`). Lockfile only — `package.json` untouched, so
no semver-major change. Took the count from 8 to 6.

---

## Accepted — will not fire here

### `exceljs` / `uuid` — moderate — **do not "fix" this**

`npm audit` proposes downgrading `exceljs` **4.4.0 → 3.4.0**. That is a major version *backwards*
in the one flagged library HomeBot actually calls directly (spreadsheet reading, 3 files). Do not
do it.

**exceljs itself has no advisory.** Its audit entry reads `via: ["uuid"]` — it is flagged purely
for depending on `uuid@8.3.2`.

The advisory ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)) affects
**only `v3()`, `v5()` and `v6()`, and only when the caller passes an external `buf` argument.**
`v1()`, `v4()` and `v7()` are explicitly unaffected — they already bounds-check.

exceljs uses exactly one thing:

```js
const {v4: uuidv4} = require('uuid');   // lib/**
... `${uuidv4()}`                        // no arguments, ever
```

`v4()`, no `buf`. The vulnerable functions are never imported and the vulnerable path is
unreachable. Even if it did fire, the impact is a silently truncated UUID — an
integrity/robustness issue rated 6.3, not data exposure.

**Verdict: accepted. Downgrading would trade a working feature for nothing.**

### The `@huggingface/transformers` chain — 4 high — no patch exists

```
@huggingface/transformers@4.2.0
├── sharp@0.34.5                  libvips CVEs: 2026-33327/33328/35590/35591
└── onnxruntime-node@1.24.3
    └── adm-zip@0.5.18            crafted ZIP triggers a 4GB allocation
```

- **No fix is available** for any of the four — not "we haven't upgraded", there is no patched
  version to move to.
- **HomeBot's own source calls none of them.** Zero files import `sharp`, `adm-zip` or
  `onnxruntime-node`; they arrive inside the local-AI/embeddings stack used for RAG.
- All are **crash / denial-of-service class** — hostile input makes something allocate too much
  or spin. None is data exfiltration or remote code execution.
- Reaching them requires getting a malicious file in front of the user *and* having them ask
  HomeBot to process it.

The only alternatives are removing local RAG entirely or waiting for upstream. Neither is
warranted for crash-class advisories in code HomeBot does not call directly.

**Verdict: accepted for v1.1. Re-check when `@huggingface/transformers` publishes an update.**

---

## How to re-check

```bash
cd widget
npm audit --omit=dev          # production surface — what ships
npm audit                     # includes build tooling, which does not ship
```

Expected today: **6 (2 moderate, 4 high)** — the two blocks above. Anything *new* deserves this
same treatment: find out whether the vulnerable code path is reachable from HomeBot before
changing a dependency, and write the answer down here.
