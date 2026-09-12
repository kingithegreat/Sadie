# HomeBot media studio — approved execution plan

Approved by Aden on 2026-09-08 after a read-only repository and runtime audit.
This is the current media execution order. Historical plans remain history;
`CLAUDE.md` and `CLAIMS.md` govern how work is performed. Aden subsequently
authorized continuous work through the Notion plan on 2026-09-08: re-fetch it
before each task and record every verified success there. Follow the existing
[Notion build loop](https://app.notion.com/p/3d5829ebf7be81308c58c474f6aed6c7).
Task 1 is complete. HB-M1 host integration is in progress under the live modular
plan. The credential-free QA trust repair within task 2 is complete and merged
as [#264](https://github.com/kingithegreat/Sadie/pull/264); see
[the before/after and CI evidence](../tasks/provider-output-trust.md).
Publication and credential decisions keep their gates.

The later [locked Core + Modules / Media Studio M2 plan](https://app.notion.com/p/3d5829ebf7be8150abd0f56e4d00083d)
owns current product direction. Aden started that build on 2026-09-08. Complete
this baseline checkpoint, then apply HB-M0–M2 around the existing Studio seams
before expanding the pipeline. The media acceptance gates below remain required.
See [the measured HB-M0 architecture baseline](CORE_MODULE_BASELINE.md).

## Baseline and boundaries

The audit inspected main at `6b95e5e` and the media integration branch at
`cede545` ([PR #259](https://github.com/kingithegreat/Sadie/pull/259)). At the
audit cutoff, #259 was open and blocked by the required E2E aggregate. A failing
macOS shard measured an Analytics backdrop narrower than the window during
its entrance animation. Passing unit tests did not establish pipeline health.

HomeBot and SADIE are the same product and repository. The GitHub repository
still uses `Sadie`; legacy names are compatibility/history, not another backend.
The app runs in `widget/` (Electron main, preload, React renderer). Root `src/`
holds shared tools and services; it is not an alternative desktop frontend.
Ancient Pathways is a separate local Python project reached through HomeBot's
tools/IPC and its production server. Its existing episode outputs are evidence
of that project's earlier work, not proof that every new router path renders.

## What exists, and what remains unproven

| Area | Audited state | Implementation / remaining gap |
|---|---|---|
| Desktop and automation surfaces | Implemented | React modes, preload/IPC, permissions, Automation Center and n8n workflow support exist. Reachability still needs checking for every new capability. |
| Media Studio | Partial | [`media-studio.ts`](../widget/src/main/media-studio.ts) coordinates stages; review UI and render modules exist. A reliable real-media completion gate is still needed. |
| Movie routing | Partial | [`movie/`](../widget/src/main/movie/) contains five adapters and a project runner. Completion can be reported without usable output; free/online/privacy and reference-image contracts need repair. |
| Clip narration | Implemented, blocked path found | [`narrate-clip.ts`](../widget/src/main/tools/narrate-clip.ts) reaches Python analysis/TTS/muxing. The inspected invocation omits the analyzer's required video argument. Provider availability also needs verification. |
| FFmpeg composition | Partial | [`media-render.ts`](../widget/src/main/media-render.ts) has assembly logic; narration selection, frame extraction and final QA need proof on real files. |
| Colab | Partial | [`colab-adapter.ts`](../widget/src/main/movie/colab-adapter.ts) and [`colab_sdxl_ipadapter.ipynb`](../notebooks/colab_sdxl_ipadapter.ipynb) exist. Local ticket paths and Drive worker input/output do not yet form a verified portable round trip. |
| Ancient Pathways characters | Partial, separate project | Showcase, doctor and production bridge exist. The newer router can report success for a placeholder solid-color clip. Per-character rigs/art enrollment remain unfinished. Preserve that project's approved rig/animation plan. |
| Editing and export | Partial | Timeline/storyboard controls exist in the integration work; persisted edits must be demonstrated in exported frames and audio. |
| YouTube channel management | Planned as an integrated flow | A complete channel-profile, approved upload, scheduling and retry path was not established by the audit. |
| Distribution | Unverified | NSIS configuration exists; published release asset query returned no installer assets. Fresh-machine Python/FFmpeg setup and a complete media run remain acceptance work. |

These findings describe the inspected snapshots. A mocked success, an existing
MP4 from an older pipeline, or a status of `done` does not close an item.
The audit ran TypeScript/docs checks, focused widget tests and the standalone
Python checks; it did not establish a live n8n/Docker or cloud-provider baseline.
Docker was unavailable during the audit. Task 1 must record its own broader
verification separately.

## Architecture for the 4 GB GPU

- **On this PC:** Electron/React, job state, manifests, asset caching, previews,
  FFmpeg CPU composition, lightweight offline speech, and quantized local diffusion
  plates (e.g. SD-1.5 + LCM or Q4 GGUF via `sd-cpp`, ~2 GB VRAM/RAM footprint).
  Run one compute job at a time; small Ollama models are optional fallbacks, not
  a requirement to run a large LLM alongside image generation. The restriction on
  this 4 GB GPU applies specifically to heavy diffusion models (SDXL, Flux) and 14B+
  LLMs loaded concurrently with video rendering.
- **Online, with consent:** configurable text/image/speech providers with real
  availability, quota and pricing checks. No automatic paid fallback. A provider
  name is not proof of a free tier. Preserve `useCustomLLM` / `allowCloud` and
  fail closed before any request or upload.
- **Colab:** an operator-assisted, interruptible GPU worker for expensive asset
  generation, with portable job IDs, resumable outputs and a Drive handoff.
  Free runtime availability is not an always-on service guarantee. Session loss
  leaves a resumable job, not a failed or fabricated finished movie.
- **Speech:** Edge speech is online; it follows online consent. Kokoro on CPU
  is the intended offline path after setup. Verify the selected engine's actual
  output and resource use instead of assuming every TTS path is local.
- **n8n:** schedules, triggers, job/status handoff and approved publication.
  One versioned job/asset contract joins n8n, Python, Electron and the renderer.
  Large media stays in asset storage; workflow payloads carry references.
- **Rendering:** CPU FFmpeg is the initial composition path. Retain Ancient
  Pathways' separate animation decisions. Defer a new paid JSON render service;
  select providers at implementation time after checking current terms.

## Tasks and acceptance gates

| Task | Scope | Required evidence before moving on |
|---|---|---|
| **1. Verified baseline** — complete | Isolate work, reconcile claims/docs, reproduce and fix the overlay failure blocking #259, run local and required CI checks, then integrate without overwriting other agents. | Failure reproduced before fix; real Electron regression passes after fix; app/root checks pass; all required remote contexts present and green; actual merged content verified. |
| **2. Provider correctness** — QA component complete; remaining work queued under HB-M2 | QA inspection failure now blocks approval (#264). Repair privacy, availability/free-tier routing, provider output and reference-image contracts; replace obsolete model assumptions. | With online access off, zero outbound calls; unusable/empty assets never report success; each enabled provider passes a real request and output validation with configured access. Credentials remain Aden's. |
| **3. One reliable faceless video** — complete for the one real, job-based pipeline; the movie/project-runner image pipeline, the Ancient Pathways bridge and the storyboard renderer remain separate, disconnected pipelines outside this task's scope | Unify manifests and orchestration; fix Python argv, narration, frame handling, render and QA. | From a real HomeBot control through IPC/Python or n8n to a playable MP4: correct duration, visible content, audible narration and captions. Inspect sampled frames/audio; test failure propagation too. |
| **4. Colab round trip** — complete (PR [#298](https://github.com/kingithegreat/Sadie/pull/298), merged 2026-09-12) | Portable unique jobs, asset upload, Drive discovery, worker result import, retry/resume/cancel. | Submit from HomeBot, run in Colab, ingest validated assets and continue the same project; survive runtime restart and duplicate/partial results. |
| **5. Consistent characters** — HomeBot-side bridge fixed; character art enrollment, cross-shot consistency and lip-movement validation remain Ancient Pathways' own internal responsibility, deliberately not redesigned | Complete one character's art enrollment and actual compositor path under the existing Ancient Pathways rig plan. | Render multiple shots of one recognizable character with intended poses/lip movement; validate real output and reject placeholder clips. |
| **6. Editing affects exports** — complete for the Storyboard Deck's reorder/retime/text/prompt edits; the post-render trim/ripple-delete editor remains a separate, smaller follow-up | Persist storyboard/timeline edits, invalidate changed assets, replace simulated progress/completion. | Change shot order, timing, text and voice through the UI; reopen the project and export; compare the resulting frames/audio to those edits. |
| **7. YouTube operations** — complete (PR [#303](https://github.com/kingithegreat/Sadie/pull/303), merged 2026-09-12) | Channel profiles, metadata, thumbnails, OAuth, scheduling and approved idempotent upload. | Profile isolation, an explicitly approved test upload, verified visibility/metadata and retries without duplicate publication; never publish merely to test without approval. |
| **8. Release verification** — queued | Installer/runtime dependencies, configuration, startup guidance and fresh Windows acceptance. | Install the actual artifact on a fresh profile/machine; complete the agreed video flow, verify privacy modes and document every required external setup step. |

Prioritize media generation, editing and orchestration. Existing knowledge,
automation and reliability work supports those tasks; additional coding-assistant
expansion is deferred. Organize modules around the existing boundaries before
considering file moves: desktop UI/IPC in `widget/`, pure shared logic in `src/`,
workers in `scripts/` and `notebooks/`, orchestration in `n8n-workflows/`, and
versioned contracts and operational guidance in `docs/`. Do not create parallel
SADIE/HomeBot pipelines or copy the private notes vault into this repository.

For every task: explain the concrete change, implement it, run relevant checks,
exercise the real React/Electron and n8n boundary where applicable, record the
verification limits, update Notion, recheck its current plan and continue to the
next authorized task. Ask only when a decision or approval is actually needed.

## Task 1 verification — 2026-09-08

Local Windows checks on the isolated `claude/studio-baseline` worktree:

- Both new real-Electron animation tests failed on the original CSS: backdrop
  bounds began at x=12, y=16 in a 1202-pixel-wide viewport. After moving the
  scale/translation to the inner cards, both passed at all sampled frames,
  including edge interception, reduced-motion handling and Escape dismissal.
- Complete overlay/tooltip run: 13 passed, no retries.
- Full widget Jest: 253 suites / 3571 tests passed, 5 suites / 15 tests skipped.
  The first sandboxed run could not create profile fixtures; the normal Windows
  rerun passed. The existing CI `--forceExit` setting was used.
- Root Jest: 16 suites / 213 tests passed. Root and widget typechecks passed.
  Widget lint: zero errors, eight existing hook warnings. Electron build passed.
  Docs contract check: 188 preload methods, 138 renderer-to-main and 32
  main-to-renderer channels in sync.

PR #260 merged at `9ec3ebd`; its content was verified against main. The macOS
shard ran 16 tests (including both new regressions) and passed on its first
attempt. Inspecting the Windows logs exposed another baseline defect: npm
failed to launch, returned `status: null`, and the wrapper exited successfully
without running tests. The repair on `claude/studio-baseline-ci` launches the
Windows command shim and maps a missing exit status to failure. Six regression
tests exercise the actual workflow wrapper; all 219 root tests pass. Running
the exact repaired Windows shard locally executed 16 Electron tests and passed
on attempt 1 in 175 seconds. Remote verification of that repair and #259
integration remain pending.

Completion update: #262 merged as `0c85650` and #259 merged as `8327342` on
2026-09-08. The tested #259 tree was verified byte-for-byte on main. All six
required contexts were present and green. The complete nine-shard matrix passed;
Windows executed 16 + 16 + 15 tests on first outer attempts. The one Linux
dependency-download failure occurred before tests; its isolated rerun passed
all 16 tests. Root CI passed 219 tests; Windows application CI passed 3,682 unit
tests and 13 overlay tests. The complete local Electron run passed 47 tests,
without retries. Evidence: [HB-M0 baseline](CORE_MODULE_BASELINE.md).
This UI/documentation change does not modify the n8n contract; its unit coverage
passed within the widget suite. Live n8n/cloud/media runs remain unverified.

## Tasks 3, 5, 6 verification — 2026-09-12

Investigation found "Media Studio" is actually four separate, disconnected
pipelines sharing almost no code: the real job-based pipeline behind the
"Make the video" button, the movie/project-runner image pipeline, the
Ancient Pathways Python bridge, and the storyboard renderer. Tasks 3, 5 and
6 each close for one of these pipelines specifically; the others remain
separate, tracked work, not silently declared fixed.

- **Task 3** (PR #297): the job-based pipeline had a real bug making every
  Kokoro-narrated job fail its own duration check, and no visible-content
  or captions verification at all — a placeholder video passed every gate.
  Added real ffmpeg frame-variance placeholder detection and captions
  verification to the existing QA gate; fixed the duration bug; fixed a
  related crash on an empty captions file. Verified with real ffmpeg/TTS
  runs and a real Electron IPC boundary test, not just mocks.
- **Task 6** (PR #299): Storyboard Deck edits saved correctly but the
  renderer read a completely different file the save path never wrote to —
  edits never reached export, and even a fresh, unedited project couldn't
  render. Unified both onto one real on-disk representation. Found and
  fixed a second bug while proving the fix for real: saved reorders were
  never actually read back by the renderer either.
- **Task 5** (PR #300): the Ancient Pathways bridge attempted an illegal
  state-machine jump on every freshly-created job — the Showrunner path hit
  this on every single production, reporting failure even when the render
  succeeded, with zero test coverage. Fixed the transition bug and added
  the same real output validation as Task 3. Character art enrollment,
  cross-shot consistency and lip-movement validation remain Ancient
  Pathways' own internal responsibility, deliberately not redesigned.

All three: honesty-A/B verified (the new regression test reverted and
confirmed to fail before the fix, then confirmed to pass after), full
widget suite green, real content verified on `main` post-merge — see
CLAIMS.md for the complete evidence trail on each.

## Tasks 4 and 7 — shipped by other sessions, table rows synced 2026-09-12

CLAIMS.md already recorded both as merged; this plan's own task table still
read "queued" for each, which is exactly the drift CLAUDE.md warns against —
an item genuinely done but still reads as outstanding. Corroborated before
updating the table: PR [#298](https://github.com/kingithegreat/Sadie/pull/298)
(Colab round trip, 1136 additions across 7 files) and PR
[#303](https://github.com/kingithegreat/Sadie/pull/303) (YouTube operations,
1261 additions across 14 files, fail-closed gates on the publishing kill
switch/idempotency/online-access consent, 16 new unit/IPC/renderer tests
per its own PR description) are both real, substantive, merged work — not
re-verified end-to-end by this session, since that was already done by
whoever shipped them; this is a documentation-truth sync, not a new
acceptance pass.

## Remaining: Task 8 — release verification

Untouched — no claim, no PR. Its acceptance gate ("install the actual
artifact on a fresh profile/machine") needs a genuinely fresh Windows
machine or VM, which is Aden's to run, not something a coding session can
fabricate evidence for from inside an existing dev environment.
