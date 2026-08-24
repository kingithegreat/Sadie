# /verify — prove the change actually works

Rule 1 of this repo is the verify-fix gate: done means the symptom is proven
gone, not that the edit looks right. Run this before saying anything is fixed.

## 1. Reproduce first

State the symptom in one line and show it happening — a failing test, a wrong
value printed, a screenshot. A fix for a symptom you never reproduced cannot be
proven to have fixed it, and this repo has shipped several.

## 2. Run the real checks

```bash
cd widget
npx tsc --noEmit
npm run lint
npx jest --config=jest.config.ts --runInBand --no-coverage
```

Root CI does **not** cover this. `ci.yml`'s `build` job runs at the repo root,
whose tsconfig covers only root `src/` and whose package has no lint or build
script, so `--if-present` skips both. Green root CI does not mean the app
compiles.

If you touched anything under `src/` at the repo root as well:

```bash
cd .. && npx tsc --noEmit && npx jest
```

## 3. Prove the symptom is gone

Re-run the exact reproduction from step 1. Not a unit test that calls your new
function — the original symptom, by the path a user takes.

## 4. Ask what reaches it

The defect this codebase produces is unreachable capability: code that exists, is
exported, is unit-tested, and that no production path calls. A unit test calls
your function directly and cannot tell whether anything else does.

Trace outward until you land on something a person can click, type or say. If the
answer is "nothing yet", say that in the PR body instead of calling it done.

```bash
cd .. && npm run audit:dead    # advisory sweep for the shape
```

## 5. Report honestly

Say which of the above you ran and what the numbers were — "widget typecheck
clean, lint 0 errors, 3,279 tests passing" — and name anything you skipped and
why. Never claim a push that did not happen; confirm with:

```bash
git ls-remote origin <your-branch>
```

If something failed twice the same way, stop and change approach rather than
retrying a third time.
