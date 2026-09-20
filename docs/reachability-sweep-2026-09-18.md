# Reachability Sweep Report (REL-3)

**Objective**: Enumerate the app's surface, trace callers, and identify dead controls/capabilities that are exported and unit-tested but cannot be reached by any user action.

As mandated by `USER_TESTING_PLAN.md`, this report enumerates the dead capabilities. **No code has been deleted yet**; each finding will be fixed or removed under its own ID.

---

## 1. Dead IPC Channels (Main ↔ Renderer Bridge)

A sweep of `widget/src/preload/index.ts` and `widget/src/main/ipc-handlers.ts` against the `widget/src/renderer` tree revealed that the following exposed capabilities are completely uncalled by the UI:

| Bridge Method | IPC Channel | Effect | Reason for flagging |
|---|---|---|---|
| `setAlwaysOnTop` | `homebot:set-always-on-top` | Toggles the `BrowserWindow.setAlwaysOnTop` flag. | No button or hotkey in the React frontend triggers this method. The UI has no pin/unpin window control. |
| `licenseValidate` | `homebot:license:validate` | Validates a locally stored license key. | The UI offers `licenseActivate`, `licenseStatus`, and `licenseDeactivate`, but never explicitly calls `licenseValidate`. It may be relying on the backend to self-validate on startup. |

---

## 2. Dead Production Functions (0 Production Callers)

Using the `find-dead-capabilities.mjs` script, the following functions were found to be exported and covered by tests, but have **zero callers** in any production code. They are either unfinished features, abandoned approaches, or test helpers that leaked into production scope.

### Documents & RAG (`main/tools/documents.ts`)
- **`storeDocument`** (12 test refs)
- **`getDocument`** (7 test refs)
- **`clearDocuments`** (7 test refs)
*Note*: The RAG subsystem handles indexing via `homebot:rag-index`, but it completely bypasses these explicitly exported document store functions.

### Hardware & Model Recommendations (`shared/`)
- **`fitsInVram`** (13 test refs)
- **`bytesToGb`** (11 test refs)
- **`formatGb`** (6 test refs)
- **`canDownloadModel`** (6 test refs)
- **`recommendModelsForProfile`** (6 test refs)
*Note*: These appear to belong to a speculative "Hardware Profile" UI that would recommend models based on VRAM. This UI does not currently exist.

### Google Colab Queue (`main/movie/colab-queue.ts`)
- **`cancelColabJob`** (2 test refs)
- **`retryColabJob`** (2 test refs)
*Note*: The Colab orchestration logic can queue jobs, but the UI has no button to cancel or retry them once they are staged. 

### Core Tools & Schedulers
- **`getOllamaTools`** (`main/tools/index.ts` - 5 test refs)
- **`stopFileWatchTriggers`** (`main/scheduler.ts` - 2 test refs)
- **`clearChanges`** (`main/file-change-log.ts` - 2 test refs)

### Misc/UI Utilities
- **`hasLeakedToolCalls`** (`shared/leaked-tool-calls.ts` - 10 test refs)
- **`placeholderGuardJsCode`** (`main/n8n-auth-guard.ts` - 6 test refs)
- **`sameTextCard`** (`shared/text-card.ts` - 3 test refs)
- **`useI18n`** (`renderer/i18n/index.tsx` - 2 test refs)
- **`explainedCheckNames`** (`shared/ancient-pathways-checks.ts` - 2 test refs)

---

## Recommended Action Plan

To fulfill the gating criteria for user testing, each category should be assigned an ID to either wire up the missing UI, or aggressively delete the dead code:

1. **REL-3.1 (IPC & Windowing):** Remove `setAlwaysOnTop` and `licenseValidate` IPC handlers, or add the missing "Pin to Top" button to the title bar.
2. **REL-3.2 (Documents/RAG):** Remove `storeDocument`, `getDocument`, and `clearDocuments` unless an upcoming Document Manager panel requires them.
3. **REL-3.3 (Hardware Specs):** Delete the VRAM/Hardware recommendation logic, as HomeBot currently forces Colab or defaults for large models.
4. **REL-3.4 (Colab Queue):** Implement the Cancel/Retry buttons in the Media Studio queue UI, or remove the unused capability from the backend.

---

## Remaining findings triage — REL-3.6 (2026-09-20)

Re-running `find-dead-capabilities.mjs` on `origin/main` after #391 (REL-3.3
VRAM/hardware removals) and #393 (REL-3.5 unassigned-export sweep) merged
shows **8** findings (down from 18). Of those **8**, most are **not** dead code —
bulk-deleting them would repeat the REL-3.3 mistake (see correction below). Each
was traced end-to-end (production callers checked in `preload`, `ipc-handlers`,
`shared/types`, and every `renderer` import) before acting.

The **8 remaining on `origin/main`**:

| Finding | Where | Real (excl. tests) caller | Verdict |
|---|---|---|---|
| `hasLeakedToolCalls` | `shared/leaked-tool-calls.ts:104` | none — `App.tsx` imports `detectLeakedToolCalls`/`stripLeakedToolCalls`/`describeLeak` from the *same* module, not this wrapper | deleted in #401 (redundant) |
| `placeholderGuardJsCode` | `main/n8n-auth-guard.ts:58` | none — only `auth-guard-fails-closed.test.ts` | deleted in #401 (alias of `guardJsCode('')`) |
| `clearChanges` | `main/file-change-log.ts:104` | none — test `beforeEach` reset lever; `ipc-handlers.ts` only imports `listChanges`/`getChange` | retained: test-only reset, no Clear UI wired yet |
| `stopFileWatchTriggers` | `main/scheduler.ts:388` | none | retained: docstring = *"used by tests so jest can exit"* |
| `explainedCheckNames` | `shared/ancient-pathways-checks.ts:130` | none | retained: coverage assertion in `ancient-pathways-checks.test.ts` (`=== DOCTOR_CHECKS`) |
| `useI18n` | `renderer/i18n/index.tsx:60` | none — `I18nProvider` **is** mounted (`renderer/index.tsx:18`) | retained: unfinished i18n adoption (product decision) |
| `cancelColabJob` / `retryColabJob` | `main/movie/colab-queue.ts` | none; **0 Colab IPC** in preload/handlers/types | retained: REL-3.4, blocked on #390 MediaStudioPanel rewrite |

### Why the retained ones are NOT deleted

- `stopFileWatchTriggers`, `explainedCheckNames`: the audit flags them by design
  (`a helper that should not be exported` / test-only). Deleting them would
  either break test reset/isolation or weaken the coverage invariant they assert.
- `clearChanges`: there is deliberately **no** Clear action in the IPC surface
  yet — the change log is bounded (`MAX_CHANGES=50`) and auto-evicts. This is a
  real but small feature gap (a Clear-history button), not cruft.
- `useI18n`: `I18nProvider` wraps the app, but no component calls the hook — the
  i18n layer is scaffolded, not adopted. Adoption is product work.
- `cancelColabJob`/`retryColabJob`: removing them contradicts
  `MEDIA_STUDIO_PLAN.md`'s commissioned interruptible Colab worker and orphans
  `.homebot/colab_queue`. Wire-up is #390's job.

## Correction — the REL-3.3 premise was wrong (2026-09-19)

The finding above says the "Hardware & Model Recommendations" functions "appear to
belong to a speculative Hardware Profile UI ... This UI does not currently exist."
**That is incorrect, and following it literally would have deleted live code.**

Both modules are reached in production:

| Live export | Reached from |
|---|---|
| `recommendSetupPath`, `recommendModelsForVram` | `renderer/components/FirstRunModal.tsx` |
| `recommendedModelIdsForVram` | `renderer/components/ModelSelector.tsx` |
| `assessModelDownloadFit` | `FirstRunModal.tsx`, `ModelSelector.tsx` |
| `DEFAULT_HEADROOM_GB` | `shared/model-pull-guard.ts` |

Only five exports were genuinely unreachable. All five are removed under REL-3.3:

- `fitsInVram`, `recommendModelsForProfile` (`shared/hardware-presets.ts`)
- `bytesToGb`, `formatGb`, `canDownloadModel` (`shared/model-download-fit.ts`)

`fitsInVram` was also the assertion helper for a live invariant — that every
recommended model fits its VRAM tier with headroom. Deleting it without re-homing
that assertion would have dropped the guard silently, so the check is now inlined in
the test that uses it.

Measured with this repository's own audit: `node scripts/find-dead-capabilities.mjs`
reported **18 findings before and 11 after**, with no new findings, `tsc --noEmit`
clean, and `docs:check` in sync.

Still exported but used only inside their own module, so the audit does not flag them:
`roundGb` and `profileForVram`. They are internal helpers rather than dead code —
un-exporting them is a separate tidy-up, not part of REL-3.3.
