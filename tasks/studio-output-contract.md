# Studio output contract and sole-owner handoff

Owner: Codex. Aden confirmed on 2026-09-13 NZ: "ok its all you now" after
being asked to pause Antigravity's Studio work. Work starts from main c90f077
on claude/studio-output-contract in the isolated completion checkout.

The previous recovery is merged as #314; its last-good output, all-scene,
offline speech and project/review identity regressions must remain intact.
The #313 branch at 3a6f6d7 and the shared checkout's uncommitted CLAIMS.md and
MEDIA_STUDIO_PLAN.md are preserved. Unique partial ratio plumbing and CSS are
reference material; the old renderer's manifest/single-scene behavior is not
restored. Follow the canonical Notion HB-REPO-314 sequence, not a wholesale merge.

First acceptance: persist an explicit captions choice on new and existing
productions, expose it in the ordinary Studio workflow, pass it across actual
IPC, and keep scene timing separate from burned-in captions. Intentionally
captionless movies must pass otherwise-valid QA without an SRT; caption-enabled
movies retain caption validation. Default new productions to captions off.
Preserve existing projects' legacy behavior until explicitly changed.

Then complete versioned ratio/duration/framing/output variants, truthful export
revision and latest-attempt state, stage/export parity and the existing workspace.
Real encoded output and restart/failure tests precede acceptance claims.
Complete owner-approved pilot, installed-build verification and owner visual
approval remain distinct gates. No paid generation, credential change or upload.

Keep #316's active nightly/timeline repair, the UI-harmony worktree, #309/#310
documentation lanes and all unrelated work intact. Pin Codex identity on every
commit command because repo-local configuration is shared by worktrees.

## Caption checkpoint (local, not production acceptance)

Seven initial failing assertions were reproduced, then 107 targeted tests passed.
Further regression coverage protects scene generation/timing with burn-in off,
rejects edits and duplicate renders during an export, and releases that lock on
failure. The review queue receives the caption choice actually rendered rather
than metadata reread after rendering. Both TypeScript checks and docs parity
are clean at this checkpoint; paired live caption-on/off export proof and full
application checks are still pending.

The separate Ancient Pathways/Showrunner Python bridge does not accept HomeBot's
caption option. Its jobs (including legacy history records) explicitly say that
caption settings belong to that external renderer, and cannot use the new
control. No caption-free claim is made for that route. Do not silently label an
uncontrolled external export with the new default. Bridge parity remains open.

The root/main nightly repair #316 merged during this work. Integrate its uniform
image format and whole-narration timeline fixes before final combined testing.

## Real Windows output proof — 2026-09-13 NZ

At `2e23161`, incorporating main `146b1a9` (#316), both caption-on/off
Electron tests passed without retries in 2.9 minutes. Each used the visible
Studio checkbox, Save Board/Render Movie, actual IPC/tool execution, cached
CPU Kokoro and installed FFmpeg. The no-caption case additionally created a
normal job through IPC, verified its new default off, changed it through the
job-card checkbox and verified that choice after a full app restart.

Both movies are eight seconds, two saved scenes, 1920x1080 H.264/AAC at 30 fps.
Caption-on measurements are the positive controls (8950/9705 white pixels);
caption-off is 0/0 in the same two sampled regions. Speech/pause/speech RMS is
identical. Both reopened, decoded and played to the ending without looping,
rejected a narration-truncating edit while retaining the old MP4 byte-for-byte,
then replaced it successfully after correction with the player loaded.
Five network-trap controls per test preceded zero speech/model requests.

Portable measurements: `docs/evidence/studio-caption-output.json`.
MP4s, sampled frames, screenshots, evidence JSON and traces are archived in
`.kilo/artifacts/studio-output-2e23161/captions-off/` and `captions-on/`.
The archived file hashes match their recorded measurements. The on output is
byte-identical to the #314 diagnostic; the off output is 113807 bytes with
SHA-256 `559b329a717b34bc338a5e805a846785d51fbe529b1843ae4d7cef5b1ab155b3`.
Images were visually inspected: captions are absent and the saved ending is
reachable in the restarted player. This is not creative/episode acceptance.

Both typechecks, build, root 227 tests, docs parity and duplicate-export guard
(one actual new source file) pass. Lint has zero errors/eight existing warnings.
The restricted full widget run could not create some home-directory fixtures;
it also had one model-delete timing failure. Outside the sandbox, all 4182
tests pass (19 skipped, 304 suites), including that test. As documented in
`ci.yml`, Jest retains a handle after completion; a final run with the existing
CI `--forceExit` run spanned a long machine suspension (24738 seconds reported)
and failed two assertions in `media-studio-stuck-job.test.tsx` after a 6581-second
test-file duration. That interrupted run is not counted as passing. Recheck the
affected suite and final combined code after integrating the newly merged #317
palette. No CI checks or test thresholds changed.

#313 was closed after recording its preserved partial ratio/CSS reference;
the branch and shared uncommitted files are untouched. #315's handoff content
is incorporated at `b3f6d61` with the owner decision brought up to date. Its
separate PR can close once this integrated continuation is published/verified.

## Final combined local gate

Main #317's palette is preserved at `c796512`. The unchanged CI Jest command
passes with exit 0: 4182 tests, 19 skipped, 304 suites in 175.072 seconds.
Both previously interrupted stuck-job assertions pass unchanged.

The first combined Electron attempt caught a test assumption: `check()` expects
a synchronous checked state, but this control changes after IPC save/refresh.
The persisted record was true, telemetry recorded success, and the failure
screenshot showed it checked. The test now uses one real click, then assertions
on actual saved state and the refreshed control. No production change, retry
increase, artificial delay or timeout increase. Failure evidence is retained in
`.kilo/artifacts/studio-output-c796512-first-final`.

Final five-test Electron run: **5 passed, no retries, 1.8 minutes**, on the rebuilt
combined app. Includes voice privacy, paired caption exports with ordinary job
setting/restart, visible storyboard creation (new captions default off), and
palette/contrast/keyboard flow. Both movie hashes and measurements match exactly.
Final traces/screenshots/outputs: `.kilo/artifacts/studio-output-c796512`.
Both typechecks, final build/docs/export guard pass; lint zero errors/eight
existing warnings. Remote checks, main integration and remaining Studio work
are separate next gates.
