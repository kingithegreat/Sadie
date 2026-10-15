# IDE-11 macOS Problems-click / ENOTEMPTY diagnose (2026-09-24 NZST)

## Scope
Held Package C1: diagnose the reproduced failure on draft #408 only — no IDE-12+ expansion, no force-push of #408.

## Conflict analysis (#408 head `9b5d86e` vs main `9700ea4`)
- **Conflicted files:** `CLAIMS.md` only (content).
- **Auto-merged:** `docs/USER_TESTING_PLAN.md`, `docs/api-reference.md`, and all IDE-11 widget sources.
- **Risk:** CLAIMS clash — merging #408 as-is could drop main's PROV-3 / clipboard rows or double-claim IDE-11. No product-code double-implement risk for Tasks/Problems (feature absent on main). Prefer fresh branch off main over force-pushing #408.

## Prior failing check (exact)
- **Run:** https://github.com/kingithegreat/Sadie/actions/runs/35544094688
- **Job:** `e2e (macos-latest, 22, 3, 3)` — https://github.com/kingithegreat/Sadie/actions/runs/35544094688/job/106166830314
- **Head:** `371051b86a9df45081e93d18c56c5ce9d7f0cdb9` (pre path-form fix)
- **Test:** `src/renderer/e2e/workspace-problems.e2e.spec.ts` — *package task reports a TypeScript problem and opens its exact editor line*

### Log excerpt
```
✘  workspace-problems.e2e.spec.ts:9:5 › package task reports a TypeScript problem and opens its exact editor line

Error: ENOTEMPTY: directory not empty, rmdir '.../homebot-ide11-home-.../.npm/_npx/.../node_modules/@modelcontextprotocol/sdk/dist/cjs'
    at workspace-problems.e2e.spec.ts:48:8

Error: expect(locator).toContainText(expected) failed
Timeout: 15000ms
Error: element(s) not found
  - Expect "toContainText" with timeout 15000ms
> 43 | await expect(page.locator('.ws-tab.active')).toContainText('broken.ts');
  44 | await expect(page.locator('.code-cursor-pos')).toContainText('Ln 2');
```
Primary acceptance failure: diagnostic/problem row became visible (`TS2322` / type message), but clicking it did **not** open an editor tab for `broken.ts`. `ENOTEMPTY` is secondary cleanup noise in `finally` after `app.close()`.

## Root cause (documented on #408, commit `9b5d86e`)
Task cwd uses the **canonical** project path (`realpath`), while the renderer HOME sandbox / `workspaceRead` expects the **raw** `projectDir` the UI holds. When those differ (symlink/junction/8.3), returned click paths fail `workspaceRead` → no tab. Fix: return diagnostic paths in the raw project form after verifying the real file stays inside the project.

## Action taken
- Left #408 dirty/open (no force-push).
- Opened fresh branch `claude/ide11-problems-diagnose-fix` off current main with IDE-11 surface + path-form fix + best-effort e2e HOME cleanup.
- Claimed IDE-11 on the new branch in `CLAIMS.md`.
