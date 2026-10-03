> **STATUS NOTICE — 2026-10-03:** This handover contains historical evidence checkpoints. Its PR numbers, commits, package references, and task states are not current. Use the [HomeBot — Current Plan in Drive](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit) as the sole execution queue and current status source; use [USER_TESTING_PLAN.md](USER_TESTING_PLAN.md) for acceptance criteria. Verify live GitHub state before acting. Do not treat old agent assignments or package evidence as current authorization.

# HomeBot finishing handover

The owner asked Codex to take over, provide prompts for the three existing agents,
and finish HomeBot using the remaining weekly allowance. No numeric allowance is
available to the coordinator. The [current Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
remains the priority authority; this file records ownership and verified evidence.

## Ownership

| Lane | Owner | Definition of done | Current state |
|---|---|---|---|
| Integration and final verification | Codex root | Reviewed changes integrated serially, required current-head contexts present and successful, landed content checked, usable current build delivered | Active; private worktrees, owner checkouts preserved |
| Studio reliability | Existing agent 1, proposed | Create/edit/save/reopen/export/play/retry/cancel work; failures preserve previous successful media | Complete prompt delivered; agent identity, branch and receipt not confirmed |
| Everyday app flows | Existing agent 2, proposed | First-run, chat, settings, voice cancellation, local-first automation and existing workspace controls have real effects and truthful guidance | Complete prompt delivered; agent identity, branch and receipt not confirmed |
| Packaging and release acceptance | Existing agent 3, proposed | Final integrated production package and installer, native/runtime checks, complete acceptance checklist and explicit installation limits | Complete prompt delivered; agent identity, branch and receipt not confirmed |
| Approved Leila art and rig | Existing AP owner plus Aden | Owner-accepted R1a source, six-second rig proof, then full episode A/V acceptance | Remains owner-dependent; no competing AP editor or generator |

## Independently verified checkpoint

PR #416 is merged on main `82c19c4e`. The fetched main tree is identical to tested
head `a21fe6bc` (full-tree diff exit 0, no output). All six required contexts were
present and successful at that PR head; strict protection remains enabled.

With exact matching release manifests/dependencies, Windows focused tests passed
22 cases with one existing skip. Widget TypeScript, scoped ESLint, docs sync and
the production build passed. Committed acceptance source:
`widget/src/renderer/e2e/workspace-problems.e2e.spec.ts`.

Additional actual production-built Electron proof used a unique temporary home,
profile, project and empty MCP config. Five transport controls executed before
the app entry. Through visible controls it skipped first-run, expanded the compact
window, opened Problems, approved the package lifecycle command, ran real npm and
TypeScript, displayed TS2322, and clicked the error to open `broken.ts` at line 2.
The source file remained unchanged; native close exited the owned process. The
result screenshot was visually inspected.

Evidence: `C:/Users/adenk/.homebot/finish-orchestration-20261001/.kilo/ide11-built-1790812034532/evidence.json`.
The earlier compact-window harness failure remains recorded separately; the
product source was not changed to bypass it.

A separate production-built runtime contains the same landed content:
`C:/Users/adenk/.homebot/test-builds/landed-main-82c19c4e/app/widget`.
Its manifest records SHA-256 for 73 compiled files. Launcher:
`C:/Users/adenk/.homebot/finish-orchestration-20261001/.kilo/launch-homebot-82c19c4e.ps1`.
Validation completed. Real export, failed replacement, restart, playback and
replacement passed with native Sharp/SQLite. The old movie hash survived failure;
the four-second 720p H.264/AAC whole-clip contact sheet was decoded and inspected.
Evidence: `C:/Users/adenk/Desktop/homebot/.kilo/finish-20261001/built-media-acceptance-a21fe6bc-1790812900687`.
This is a silent geometric fixture, not episode/narration quality acceptance.
Seven settings/security stages also passed, including credential-free backup,
explicit indexing, sibling-path denial and native close. The Advanced screenshot
was inspected; its metric badges run together, assigned to the everyday lane.
This is a built test app, not an updated installer.

## Remaining integration

PR #417 is a held recovery-test change, not a completed production episode. Root
reviewed it in `C:/Users/adenk/.homebot/pr417-integration-20261001` after merging
fresh main locally; 64 export-contract cases passed. The recorded-checksum
assertion contained an always-truthy fallback and now compares the persisted
checksum with the original movie bytes. A controlled stale checksum passed the
former oracle and failed the strict oracle as expected; the strict file was
restored and all 64 cases passed. TypeScript and scoped ESLint passed.
Its Kokoro live narration test has not run: the
matching dependency tree has no cached Kokoro model. No model was downloaded.

Do not duplicate IDE-11: #416 already landed. Keep #413, #296, #368 and #261 held
under their existing evidence/decision conditions. Do not expand new providers,
rig generators or held IDE features merely to fill the allowance.

## Acceptance still required

- Approved Leila art, rig mechanics and a complete episode with full narration,
  ending, saved edits, restart playback, repeat export and failure preservation.
- Live response from an already configured model/account; synthetic replies prove
  routing, not account availability or model quality.
- Real microphone/voice acceptance where required by the release checklist.
- Final integrated production package and actual installation on a Windows
  profile or machine that has never used HomeBot.
- Owner visual/audio review. Silent diagnostic fixtures prove mechanics only.

Preserve Online consent, credential/account ownership, signing and publication
boundaries. No paid generation, model download, owner-profile replacement or
publication is authorized by this handover. Keep dependency junction targets and
all original assets, previews and evidence intact.
