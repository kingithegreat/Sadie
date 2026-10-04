# APP-CAPABILITY-FFMPEG-1 — truthful media engine readiness

Baseline: fresh main `d22443b1ddf08e23809fc309bf01cacebce9592d`.
Private branch: `claude/pro-reliability-ffmpeg-readiness-20261003`.

The delivered launcher deliberately supplies a working `HOMEBOT_FFMPEG`.
Actual media discovery supports that explicit binary, the managed installation,
PATH and common Windows locations. The capability probe checked only PATH and
managed storage, so an isolated portable launch could render successfully while
Home's System check claimed the video engine was missing and suggested setup.

Reachability: `CapabilityReport.tsx` calls `getCapabilityReport`; the production
`homebot:capability-report` handler calls `probeCapabilities`; the shared report
maps `ffmpegAvailable` into ready/missing guidance. No renderer behavior changes.

The probe now reuses `findFfmpeg` with its own real runnable version check and
4,000 ms per-process timeout. It preserves rendering's explicit/managed/PATH/
portable search order, validates execution rather than file presence, and falls
back after a managed-directory lookup failure. Executable discovery now lives
in the neutral `ffmpeg-resolver.ts`, importing only Node `fs` and `child_process`.
`media-render.ts` re-exports the same function for existing rendering callers.
The resolver's search behavior and 10-second default render probe are unchanged;
there is no startup side effect or capability import cycle.

Verification:

- Unchanged source baseline: 9 tests executed, 6 failed, 3 existing controls
  passed. Retained `.kilo/evidence/ffmpeg-baseline.log`.
- Final source: 3 suites/78 tests passed, including 11 probe cases covering
  explicit and portable detection, runnable negatives, media search order,
  managed lookup failure and `ETIMEDOUT` fallback with the 4,000 ms bound.
  Retained `.kilo/evidence/ffmpeg-final-focused.log`.
- Widget TypeScript, changed-file ESLint and diff whitespace check passed.
- Actual existing FFmpeg process: a source-level A/B uses the original exported
  probe, controlled network/Electron/managed seams and no PATH engine. Baseline
  reports false; fixed reports true; the unchanged media resolver selects the
  same absolute executable. Real `-version` succeeds and executable SHA-256 is
  unchanged. `.kilo/prove-ffmpeg-readiness.cjs` and
  `.kilo/evidence/ffmpeg-real-source-proof.json` retain that proof.

PR #462's initial `b0a8a5c` failed both root build contexts in the root Jest
module-boundary test: the diagnostic's dynamic import of `media-render.ts`
crossed Core into Production Studio. The unchanged clean `d22443b1` tree passes
the same scanner; `b0a8a5c` produces exactly that one violation. Failed cloud
logs are preserved as `.kilo/evidence/ci-37104075693-failed.log` and
`ci-37104079635-build-job.log`. The boundary checker and its exceptions remain
unchanged. Extracting only the shared executable resolver removes that edge.

The corrected tree passes the actual root boundary Jest suite (8 tests,
including positive controls for forbidden imports) and 4 affected widget suites
(97 tests), including the existing setup/rendering resolver contract tests.
Widget TypeScript and all changed-file ESLint checks pass. Logs are retained as
`resolver-root-boundary-jest.log`, `ffmpeg-resolver-focused.log`,
`resolver-typecheck.log` and `resolver-scoped-lint.log` under `.kilo/evidence`.
The refreshed real-CLI proof is written separately to
`ffmpeg-resolver-real-source-proof.json`, recording the executed source hashes
and commit, renderer/neutral resolver identity, and both real probe bounds.
The original precommit proof remains preserved; its baseline source-head label
does not claim that the later commit was already checked out.

The corrected commit was held as a draft under root review with automatic
merging disabled while its cloud checks ran. Final integration is recorded below.

After the Code view-state PR #463 landed as `9613c7c766c75396deefb2b9be07507c61bbf35d`,
this published branch was refreshed by a normal merge, preserving history.
Only CLAIMS.md conflicted; both owner sections were preserved. The renderer
tree is byte-identical to landed main, while the FFmpeg production files are
unchanged from reviewed `e8d625f`. The merged tree passes 11 widget suites /
143 tests (97 FFmpeg + 46 Code), the 8 root boundary tests, widget TypeScript,
scoped ESLint for both areas, docs drift and whitespace checks. Retained logs
are `main9613-merged-*` under `.kilo/evidence`; a separate exact merged-head
`ffmpeg-integrated-real-source-proof-<head>.json` preserves the refreshed CLI
proof without rewriting older receipts. The fresh merged-head CI subsequently
completed as recorded below.

Dependencies are a read-only junction to the root-owned private integration
tree after four manifests/locks matched exactly. No dependency installation,
native rebuild, Electron GUI, package build, media render, download, provider
request, owner-profile change or merge was performed. Source-level execution
and real FFmpeg CLI behavior are proved; refreshed built/package/installer
acceptance remains separate. Root owns integration and delivery.

## Source completion and separate delivery hold

Root merged [PR #462](https://github.com/kingithegreat/Sadie/pull/462) at
`c2ea3121b10eded032062586ad4162f6229edef4` on 2026-10-03T07:35:14Z.
The reviewed head was `9072151c09bb520c5c2fcdcdde30f0f7f500e751`.
An exit-0 complete-tree comparison and identical tree object
`85f9e56845aa3b7ce27b59c763247ed27636b8ac` prove that the reviewed content landed.
The retained receipt is `.kilo/evidence/pr462-landed-provenance.json` in the
private `pro-reliability-20261003` worktree. The APP-CAPABILITY-FFMPEG-1 source
claim is retired; this documentation follow-up contains no production changes.

All 23 final-head check contexts succeeded, including both build contexts.
All six live strict required contexts were present and green: build,
duplicate-export-guard, ESLint (React Hooks), Permissions smoke test, widget
and e2e-all. The nine OS shard jobs actually executed their E2E step successfully
in [the final matrix run](https://github.com/kingithegreat/Sadie/actions/runs/37105562423).
This does not mean all tests passed on their first attempt. Windows shard 1's
media-feed case failed its initial execution and retry 1, then passed retry 2;
whole attempt 1 nevertheless exited 1. The existing workflow's whole attempt 2
completed 24 passed and exited 0. No retry policy or gate was changed here.

The final reviewed source also retains the integrated 143 widget tests
(97 FFmpeg + 46 Code), 8 root boundary tests, TypeScript, scoped ESLint, docs
and whitespace results. The exact-head real-CLI proof is
`.kilo/evidence/ffmpeg-integrated-real-source-proof-9072151c09bb520c5c2fcdcdde30f0f7f500e751.json`.
Earlier failed logs and source proof receipts remain unchanged.

At the historical resource-gate checkpoint, refreshed package acceptance was
pending the standing 5 GiB disk / 2 GiB RAM guard. At
2026-10-03T07:36:05.841Z the guarded
invocation rejected 4.736400604 GiB disk headroom before launching any child;
RAM then passed at 2.201671600 GiB. The later 07:37:46.946Z read-only snapshot
reported 4.734916687 GiB disk and 1.981899261 GiB RAM, with no helper lock.
No stage or widget/out was allocated by that rejected invocation. This source
completion does not claim a refreshed package, GUI proof, installed acceptance
or owner-profile change.
Root retains APP-PACKAGE-REFRESH-2 execution and delivery ownership. External
claims and the other owner's #461 are preserved.

## Documentation refresh after #465

This retirement is integrated against documentation baseline main
`2a656bc7315be85acc4ba1e43d84095ae6bdc2d8`. The foreign #465 authority/status
changes and Code claim are preserved; #461's owner-held files are untouched.
Only this task and the APP-CAPABILITY-FFMPEG-1 claim differ from that baseline.
Root/release_finish owns the new source-2a656bc package lane. Its new runtime
Code/native/Whisper/Kokoro proof and replacement delivery remain pending; the
earlier delivered 4c78098f package and failed intermediate attempts are retained.

The earlier draft #464 CI at exact `05f714277e63674a59d4b64fdbeb0808418131ae`
is historical after this refresh. Independent saved-log verification proved
all 23 successful checks, all six strict required contexts, and actual Build
widget / Run E2E execution in all nine OS shards: 196 passed and 95 skipped,
291 declared across the matrix. All nine passed their first outer invocation;
no internal Retry markers or flaky summaries were observed. Widget workflow
attempt 3 executed 371 passing unit suites / 4,932 passing tests (11 suites /
33 tests skipped), a real build, and 14 passing E2E tests. Earlier attempt 2's
installed-model delete assertion received null at model-delete.test.tsx:68;
that failed log is retained, and precise scheduling cause is unproved.
The reviewed head and actual CI synthetic checkout `ee0b9a77` had identical
full trees `1a2a8f7186cf82735ce0fa582cf36ac1544e5f87`. These old checks did not
transfer; refreshed retirement head `f7f55a9f` completed its own exact-head
checks and root review, then merged as `102b4c56`.
Immutable independent receipt:
`C:/Users/adenk/.homebot/.kilo/pr464-independent-ci-verification-1791016867701.json`.

### Narrow post-merge P2 disposition

The retained #462 review concern
[P2](https://github.com/kingithegreat/Sadie/pull/462#discussion_r4172181544)
was not reproduced with installed ts-jest 29.4.5 / TypeScript 5.9.3. The actual
transformed re-export had a configurable getter; the spy returned null and
restored the original result, while a deliberately nonconfigurable getter
produced the claimed failure. The existing selected missing-FFmpeg live case
passed one test with five skips and exit 0, using `HOMEBOT_LIVE=1` and
`--forceExit`. It exercised no real FFmpeg/TTS or GUI/package and establishes
neither full-nightly success nor natural full-suite shutdown.

Receipt and transcripts:
`C:/Users/adenk/.homebot/integration-audit-20261003/ffmpeg-review-triage/receipt.json`.
They are retrospective transcriptions from retained tool responses; full raw
logs and truncated registration noise are unavailable. The source/test hashes
match this refresh, but no test was rerun by this documentation lane. No source
correction is warranted by that bounded result. Root retains thread disposition;
the last recorded thread status was unresolved, not newly cleared here.
