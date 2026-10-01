# MS-A-last-good — Milestone A last-good harness

**Claim:** `MS-A-last-good` on `claude/msa-last-good-harness`  
**Source:** `docs/USER_TESTING_PLAN.md` Milestone A / #390 last-good-output gap  
**Scope:** EXISTING fixtures only. No art regen, Pollinations, Ancient Pathways, paid APIs, MS-RIG-0, MS-12, or Code-mode Milestone B.

## What this hardens

1. `widget/src/main/__tests__/storyboard-export-output.test.ts`  
   New case: *Milestone A: injected re-render failure keeps last-good bytes, pointer and reopen path* — succeeds once, injects an encoder failure on the next render, asserts path + sha256 unchanged and `mediaGetStoryboardHandler` still returns the last-good movie with `latestAttempt.status === 'failed'`.

2. `widget/src/renderer/e2e/storyboard-export.live.e2e.spec.ts`  
   After the existing speech-truncation inject failure, restart the same isolated profile and prove last-good path/sha256/player before repairing the edit. Evidence fields: `milestoneALastGoodAfterRestart`, `milestoneALastGoodPath`, `milestoneALastGoodSha256`, `isolatedProfile`.

3. `widget/src/renderer/e2e/studio-export-freshness.live.e2e.spec.ts`  
   Keeps the corrupt-frame inject + restart + playback proof; evidence JSON now labels Milestone A path/sha256 explicitly and asserts the project pointer still names the pre-failure movie before playback.

## Not claimed

Full Milestone A owner visual/audio episode acceptance, installer proof, or closing #390 recovery/next-action/no-double-pay beyond last-good preservation.

## Opt-in live gate

Real Electron cases require `HOMEBOT_STUDIO_EXPORT_LIVE=1` and installed FFmpeg (`HOMEBOT_FFMPEG`). Ordinary CI still runs the unit checksum harness.

## 2026-10-01 serial review on main 82c19c4e

Merged current main without product changes. The persisted checksum must now equal
the original movie checksum. A controlled stale checksum passed the former
`sha256 || beforeHash` oracle and failed the strict oracle as expected. The strict
file was restored; 64 export-contract cases, widget TypeScript and scoped ESLint
passed. Local oracle evidence:
`C:/Users/adenk/.homebot/pr417-integration-20261001/.kilo/checksum-oracle-1790813084924/evidence.json`.

Independent production-built Windows Electron proof on identical main content
exercised native Sharp/SQLite, real FFmpeg export, failure preservation, restart,
playback and replacement. Evidence:
`C:/Users/adenk/Desktop/homebot/.kilo/finish-20261001/built-media-acceptance-a21fe6bc-1790812900687`.
The whole-clip decoded four-second 720p H.264/AAC contact sheet was inspected.
This silent geometric fixture proves mechanics, not narrated/creative quality.
The committed Kokoro live scenario remains unrun: no cached model was found in
the matching dependency tree. The draft/owner acceptance hold remains in force.
