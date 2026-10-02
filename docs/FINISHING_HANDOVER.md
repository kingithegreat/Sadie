# HomeBot finishing handover

The owner asked Codex to take charge, deploy agents and finish HomeBot. Three
actual delegated agents now own the bounded lanes below. The earlier prompts
for external agents remain historical proposals; their receipt is unconfirmed.
The [current Drive plan](https://docs.google.com/document/d/1gaMqUoQ1jfJcLREqKyMAhVBLiEy1oYZEOnOydZxaQWE/edit)
remains the priority authority; this file records ownership and verified evidence.

## Ownership

| Lane | Owner | Definition of done | Current state |
|---|---|---|---|
| Integration and final verification | Codex root | Reviewed changes integrated serially, required current-head contexts present and successful, landed content checked, usable current build delivered | Active; private worktrees, owner checkouts preserved |
| Editor save during newer edits | Codex `/root/plan_gap_audit` | Completing an older save marks only its written contents clean; newer edits stay unsaved and close still prompts | #458 MERGED as 8fe85569; all 23 reviewed-head checks passed, including all six required contexts and nine OS shards; 20 focused cases and six actual built Windows stages passed |
| Offline Whisper and current-source verification | Codex `/root/release_finish` | Original cache-only loader works with Online off; no remote model fetch; microphone transcription acceptance remains distinct | #457 MERGED as 4c78098f; all 23 reviewed c7068f93 checks passed, including all six required contexts and nine executed OS shards; 45 focused cases and four actual built Windows stages passed |
| Media inventory, review and documentation | Codex `/root/media_finish` | Current asset/source hashes, inspected artifacts, explicit approval limits and accurate handover records | Read-only AP review packet and final delivery documentation complete; 20 staged slots present, 22 absent; root review/publication retained |
| Packaging and release acceptance | Codex root | Final integrated production package and installer, native/runtime checks, complete acceptance checklist and explicit installation limits | Exact 4c78098f package, scanners, actual native/Code/Whisper/Kokoro scopes and validated launcher passed; distinct Desktop copy delivered; owner/fresh-install/creative gates open |
| Approved Leila art and rig | Existing AP owner plus Aden | Owner-accepted R1a source, six-second rig proof, then full episode A/V acceptance | Remains owner-dependent; no competing AP editor or generator |

## Current finishing checkpoint

Current production source is `4c78098fa9c4a03fa3cbb33cfed8166a9898bfcf`.
Documentation baseline `cb95f970df88f1385869dd6b26bea3af2dc34046` adds only
#459's claim retirement above that production source.
Both bounded source fixes are merged and their implementation claims retired.
The verified delivery below contains both fixes and #456 navigation. Root
retains release ownership; fresh Windows installation remains unaccepted.

[PR #456](https://github.com/kingithegreat/Sadie/pull/456) landed as `516e1034`
after all 23 reviewed-head checks passed, including all six required contexts.
The new navigation E2E actually ran on Windows, macOS and Ubuntu. Landed
`516e1034` has an empty production-tree diff from reviewed `68c5f3b4`.
The visible Back control preserves workspace tabs and unsaved edits; Escape remains in editors
and dialogs. Prior delivered c46d45eb and its profile/shortcut remain preserved;
the new exact-main delivery below records separate acceptance.

## Verified final package delivery

The unsigned exact-4c78098f package was built privately at
`C:/Users/adenk/.homebot/final-release-4c78098f-1790933846398`.
Unchanged preflight/artifact/integrity scanners passed. Installer: 320,489,797
bytes, SHA-256 `3F4F97375AD2D94ECB90858D4A78515BAE237890E2A9B2BE7AAE748F0EF923BF`.
Actual native scope passed first-run, Sharp/SQLite, real export, deliberate owned
encoder-input corruption after QA, preserved old movie, restart/player,
replacement export, owned native exits and unchanged package hashes. Evidence:
`evidence/pristine-acceptance-4c78098f-1790939954842/stages.jsonl` under that package.

The corrected actual packaged Code proof passed keyboard input, original save
handler, Back, save snapshot, unsaved marker, Close/Cancel, native exit and
unchanged package hashes. Five positive controls executed; classified fixture
HTTP remained denied, with no forbidden or unknown requests. Evidence:
`evidence/code-package-4c78098f-1790942077956/evidence.json`.
Code cursor/undo/view state resets on Back remain a known limitation; preserving
the file/tab and unsaved contents does not establish preservation of that state.

Actual unchanged final-package Whisper recognized the known speech fixture
via file-backed Chromium capture with Online off and zero model fetches. This is
technical fixture transcription, not a human microphone utterance. Actual
Kokoro freshly generated nonzero-RMS 7.7-second offline narration, exported it,
and passed restart/player checks. Root inspected the Whisper textarea, Code
unsaved screenshot, native complete FFmpeg decode and representative decoded
frames, and Kokoro movie contact sheet/restart player. Human listening remains open.
Evidence: `evidence/whisper-offline-package-proof-1790942092131/evidence.json` and
`evidence/real-offline-kokoro-1790942229272/evidence.json`.

`evidence/package-launch-manifest.json` binds all four proofs and all 316 runtime
files. Eleven genuine already-authorized cached model files (385,531,938 bytes)
were copied and hash-validated; no new model download. The delivered
`launch-homebot-4c78098f.ps1 -ValidateOnly` passed runtime, installer, cache and
ownership checks. New Desktop `HomeBot - Packaged Main 4c78098f.lnk` was created
and its target/arguments read back; `evidence/desktop-shortcut.json` records it.
HomeBot profile, projects, AP fixture and OS stores are isolated in the new
launch profile. **CODEX_HOME intentionally remains C:/Users/adenk/.codex**, sharing
existing owner authentication, configuration and history; do not call every
store isolated. Existing apps, profiles and shortcuts remain unchanged.

Capacity recovered enough to complete these scopes. Earlier ENOSPC, disk-guard,
observer/registration and classification failures remain retained; they do not
establish an app defect. Technical delivery is complete; full owner release,
fresh Windows installation, listening, human microphone, actual entitled Pro,
Leila rig and full narrated episode acceptance remain open.

## Source-fix evidence

#458's six-stage Windows proof delays the response from the first actual save,
types newer text through the visible editor, checks the unsaved marker and
close/Cancel behavior, writes the newer bytes on a second save, and exits the
owned native process. Evidence:
`C:/Users/adenk/.homebot/finish-save-snapshot-20261002/.kilo/save-snapshot-built-1790915672759/evidence.json`.
The earlier observer failure is retained. This is built-source evidence, not a
new packaged-app or installation claim.

[PR #458](https://github.com/kingithegreat/Sadie/pull/458) is MERGED as
`8fe8556967f49be9615490208e4301ccf30d8286`. All 23 checks at reviewed `bde2d62a`
passed, including every required context and the nine OS shards. The save
agent independently fetched and verified a zero full-tree diff between landed
`8fe85569` and tested `bde2d62a`. The save implementation claim is retired;
root retains final packaging and acceptance.

#457 has 45 focused cases and four real built stages recorded by its owner.
The original cache-only loaders returned the known fixture transcript with Online off,
zero model fetches and all seven real cache files unchanged; recording tracks
ended and the owned native process exited. Root inspected the screenshot and
final evidence:
`C:/Users/adenk/.homebot/.kilo/whisper-built-current-1790916037485/evidence.json`.
Final reviewed head `c7068f93` incorporates #456 navigation and #458 save fixes;
the bounded Whisper source/tests remain identical to the verified voice change.
PR #457 MERGED as `4c78098fa9c4a03fa3cbb33cfed8166a9898bfcf` after all 23 checks
passed, including every required context and nine executed OS shards.
Offline fixture decoding does not establish owner's
spoken microphone transcription or listening quality.

A separate session subsequently recorded actual packaged offline Whisper proof
from tested source `65824043`: controlled baseline model request reproduced;
fixed original loaders returned the exact fixture transcript with zero fetches
and native exits. Root read its finalized passing evidence at
`C:/Users/adenk/.homebot/.kilo/whisper-offline-package-proof-1790915933557/evidence.json`.
Preserve that session's newer task/CLAIMS evidence during final integration;
#457 source integration is complete. This packaged fixture is distinct from
a human microphone utterance or refreshed final-main package.

Read-only AP `a3288d3` now contains a staged `leila_r1a` library: 16
executor-reported accepted source cells plus four derived crops. All 20 sprite
files and all 16 tracked source files match committed bytes; all contact sheets
were inspected. Explicit Aden acceptance was independently located for Cell 1;
the other 15 approvals remain executor-reported. The live 42-slot Leila library
and owner anchors remain unchanged. The staged library has 14 head boxes and no
mouth group or mouth anchors. Its 22 missing slots are seven expressions, two
right-facing head turns, eight mouths and five body-mechanics poses. Right-facing
mirrors were rejected by the AP owner because they reverse flower/scarf identity.
The committed claim records PASS/released; the working lock was already absent
and this audit removed no lock. Remaining assets, owner approval/handover,
production scale/rig integration, the six-second joint/expression/prop proof and
full-episode A/V acceptance remain open. Existing September proof/episode files
predate these assets. Review packet (kept outside this repository):
`C:/Users/adenk/.homebot/finish-media-review-20261002/review.html`.

Previously verified scheduled checkpoint (2026-10-02 NZ): main Release Gate
and Nightly Media checks were green on
`12b243e5`; nightly logs show three suites and 69 actual tests passed. These
checks do not substitute for owner A/V acceptance.

## Historical independently verified checkpoint — 2026-10-01 NZ

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

## Historical recovery integration checkpoint — 2026-10-01 NZ

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

## Current acceptance still required

- Approved Leila art, rig mechanics and a complete episode with full narration,
  ending, saved edits, restart playback, repeat export and failure preservation.
- Spoken microphone transcription and owner listening/voice review. Existing
  actual ChatGPT reply, microphone capture/cancellation and packaged offline
  Kokoro evidence remain recorded in the local release checklist; synthetic
  replies and isolated Whisper decoding prove separate technical properties.
- Actual installation on a Windows profile or machine that has never used
  HomeBot; the final production package and separate validated launch copy are
  delivered, while this installation gate remains open.
- Actual entitled Pro execution; Free upgrade/edit/delete preservation evidence
  does not establish that paid entitlement path.
- Owner visual/audio review. Silent diagnostic fixtures prove mechanics only.

Preserve Online consent, credential/account ownership, signing and publication
boundaries. This handover grants no additional paid generation, model download,
owner-profile replacement or publication permission. Previously consented
offline-model evidence remains distinct. Keep dependency junction targets and
all original assets, previews and evidence intact.
