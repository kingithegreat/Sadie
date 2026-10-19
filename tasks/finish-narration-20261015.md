# FINISH-NARRATION-20261015 — checkpoint, 19 October 2026

Fresh source base: `origin/main` `12b11c385d746ed1908717b314c5415162e1061d`.
The Drive task assigned this branch name from `acede878`. The old remote branch
had no unique commits and was 30 commits behind current main; no open PR was
found through connected GitHub search. Work continues on the same named branch
from fresh main.

## Scope

1. Reproduce and correct the nightly Edge speech 403 and narration `voiceLocale`
   crash on the actual reachable Media Studio path.
2. Verify the current installer on the corrected source without signing,
   account setup, paid requests, owner credentials, or publication.
3. Keep Linux/source checks separate from hosted Windows runtime acceptance.
   Do not claim fresh speech or an episode until HomeBot produces and plays it.

## Findings and change

- Latest failing nightly run: [39106307387](https://github.com/kingithegreat/Sadie/actions/runs/39106307387), job `117612778475`, tested `df32ef43`. Its Media Studio suite recorded Edge TTS `Unexpected server response: 403` and the real IPC failure `Cannot read properties of undefined (reading 'voiceLocale')`.
- Current main at `12b11c38` has no later voice fix; `widget` still locked `msedge-tts` 2.0.7. Its Edge initializer attempts the fallback on that same partially initialized library instance.
- Upstream [merged PR 39](https://github.com/Migushthe2nd/MsEdgeTTS/pull/39) moved synthesis to `api.msedgeservices.com` and changed the subscription-key query parameter. Upstream [metadata hardening](https://github.com/Migushthe2nd/MsEdgeTTS/commit/defebdd7f81aa760340affac21629a6b71bccb8e) fixed the optional `voiceLocale` handling. Version 2.1.0 contains these fixes.
- Updated the widget dependency and lock to exact `msedge-tts` 2.1.0, retaining the registry integrity value and updating its locked `ws` dependency. Added `msedge-tts-compat.test.ts` to guard both regressions without contacting the speech service.

## Verification

- New compatibility tests and `narration-engine.test.ts`: 2 suites, 12 tests passed against the actual 2.1.0 npm package in an isolated temporary install. No speech request was sent.
- Positive control against the existing 2.0.7 package: both new checks fail for the original `voiceLocale` crash and obsolete `speech.platform.bing.com` endpoint. Temporary package files and cache were removed.
- A full local widget typecheck is not claimed: this isolated worktree has no dependency installation. A temporary path-remapping attempt bypassed package type exports and is excluded from evidence. Exact-head hosted Windows typecheck remains required.
- Latest main-based installer baseline: run [39203043731](https://github.com/kingithegreat/Sadie/actions/runs/39203043731) succeeded for a PR merge containing current main `12b11c38`; the new dependency change still needs its own run.

## Remaining

Push the reviewed branch as a draft PR, confirm all required Windows checks and a real fresh narration succeed on the exact head, then verify installer readiness on that head. Preserve any provider rejection as a remaining limit; never infer a playable episode from unit tests alone.
