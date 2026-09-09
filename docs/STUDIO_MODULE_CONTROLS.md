# HB-M2 checkpoint — Studio module controls

The main navigation now includes **Modules**. Production Studio shows its installed
version, runtime status, required modules, optional connections and requested
permissions. Disable removes Studio navigation and tool exposure; Enable restores
one workspace and one copy of each tool. Open Studio reaches the existing editor.
Existing projects, source files, permission choices and Online consent are retained.

This extends [the trusted module host](CORE_MODULE_CONTRACT.md) under the
[current Notion plan](https://app.notion.com/p/3d5829ebf7be8150abd0f56e4d00083d).
It is a bounded M2 controls checkpoint. Speech/movie-provider privacy work, lazy
loading of main-process engines, Studio-specific settings contributions and real
video acceptance remain separate M2 work. This is not independently downloadable
plugin packaging and does not complete the Studio pilot.

## Execution and persistence

`main/modules/module-ipc.ts` accepts only the actual HomeBot window's main frame,
an installed module ID and a boolean. It cannot accept manifests, code, permissions
or renderer-supplied grants. All changes use the existing `TrustedModuleHost` and
its generation, permission, entitlement and drain checks. Disabled Studio's
existing IPC facade continues to return `MODULE_UNAVAILABLE` before domain work.

Core stores schema-v1 choices in `config/module-preferences.json` under Electron
userData. The file contains only `schemaVersion` and `disabledModules`. It is
separate from general settings so an old Settings form or settings import cannot
accidentally re-enable a module. Writes use an operation-specific temporary file
and rename; save failure leaves runtime state unchanged. Failed activation restores
the previous preference. Corrupt/unreadable preferences leave optional modules
off and display a recovery message without replacing the damaged file.

Existing installations keep Studio enabled when no module preference exists.
Startup reads the saved choice before activation, and repeated initialization
cannot re-enable a disabled module. Disable saves the choice immediately, removes
tool registrations and enters `draining` while already-started calls finish. The
screen reports this state through lifecycle events and prevents concurrent changes.
Worker cancellation and durable job recovery remain M3; draining does not promise
to cancel an active render.

## Renderer boundary

Studio declares the namespaced workspace view in its manifest. The host permits
only reviewed view IDs; provider/settings contribution types remain unsupported.
`renderer/modules/bundled/` maps known IDs to compiled lazy components and navigation
metadata. Manifest values never become import paths. Core mounts available module
views generically, and returns to Modules if a disabled workspace is requested.
The old App-to-MediaStudioPanel import exception has been removed from the AST
boundary guard. Lifecycle subscriptions and obsolete list responses are cleaned up.

## Verification

The regression paths are:

- `widget/src/main/__tests__/module-startup-preference.test.ts`: original startup
  re-enabled Studio despite a saved disabled choice. The disabled case failed and
  the enabled control passed before the fix. Both pass afterwards.
- `widget/src/main/__tests__/module-controls.test.ts`: real temporary storage and
  registry, restart, stale handlers, one-copy restoration, drain, save failure,
  grant rejection, corrupt preferences, unknown module identity and startup
  dependency ordering without overriding a saved disabled dependency.
- `widget/src/main/__tests__/module-control-ipc.test.ts`: sender/frame and payload
  validation before controller dispatch.
- `src/__tests__/module-boundaries.test.ts`: real-tree import scanning plus an
  explicit rejected App-to-Studio import.
- `widget/src/renderer/e2e/module-controls.e2e.spec.ts`: real fresh-profile Electron
  clicks Disable, verifies absent navigation/tools and denied Studio IPC, restarts,
  verifies the saved choice and retained files, enables Studio, and creates an
  actual storyboard through Open Studio. No media provider success is mocked.

The combined Windows checkpoint includes movie privacy #266/main `19535cb`.
It passes 274 widget suites / 3,844 tests (15 skipped) and 18 root suites / 227
tests. Both typechecks, build, docs, AST import boundaries and the duplicate-export
guard pass; lint reports zero errors and eight existing warnings.

The final combined full Electron suite passed **50 tests in 10.5 minutes without
retries**, including the new module controls test (34.5 seconds), movie privacy
(17.5 seconds), existing Studio-to-disk regression (16.9 seconds), navigation,
overlays and streaming. Initial focused verification passed 44 module tests and
two real Electron tests without retries. Remote integration is tracked in the
[claims ledger](https://app.notion.com/p/3d5829ebf7be814eaccceeaaa9b1e565).
Creating a storyboard proves reachability and file persistence, not playable video.

## Remote checkpoint and current-main integration

[PR #269](https://github.com/kingithegreat/Sadie/pull/269), head `167c39b`, passed
all six required contexts. Windows application CI ran 3,844 widget tests, 227
root tests and 13 overlay tests. All nine Electron shards passed; the new controls
case passed on Linux/macOS/Windows in 5.1 / 15.0 / 11.6 seconds. Windows ran
17 + 17 + 16 tests on the first outer attempt; the existing Movie Router privacy
case in shard two passed on an inner retry after a timeout.

Image artifact PR #267 merged first as `4b9cdf2`, requiring a latest-main merge
under strict branch protection. The only conflict was the claims table;
application code combined automatically. The combined checkpoint `41ee7fb`
passes all 3,867 Windows widget tests (15 existing skipped), app typecheck,
build, lint (the same eight warnings), docs and import checks. Six affected real
Electron cases passed in 1.0 minute without retries: module restart controls,
Studio storyboard creation, movie Online denial, and PNG/JPEG/corrupt image
output through the real local transport, decoder and saved-state paths. Root
production code/tests are unchanged from the preceding 227-test checkpoint.
Final CI and merge status remain in the linked ledger.

## Final startup regression and complete local verification

The unchanged M0 measurement found a real navigation obstruction on `1090fdd`:
the startup graphics-card toast intercepted Studio clicks until its ten-second
expiry. The three samples took 9,653 / 9,591 / 9,550 ms. Playwright's action log
identified the toast as the intercepting element; this was not Studio render time.

`overlay.e2e.spec.ts` now requires the actual toast to stay below the responsive
header, preserve page position and permit a normal Studio click while visible.
The regression failed before the fix at toast top 44 px versus header bottom
169 px. `e12cf00` positions the portalled notification below the measured header
and observes header/window resizing, with listener cleanup. The regression passes
in 5.1 seconds. No click forcing, expiry waits or timeout increases were added.

The final rebuilt Windows app passes **all 53 real Electron tests in 5.5 minutes
with retries disabled**, including module restart controls, image decoding/cache
and corrupt-output rejection, privacy, Studio-to-disk creation and overlays.
All **3,867 widget tests** pass (15 existing skipped; 275 passing suites).
App typecheck, build, docs and lint pass; lint retains eight existing warnings.
Root code/tests remain unchanged from the preceding 227-test checkpoint.

After local test/build workloads ended, the original measurement script ran
unchanged on clean `e12cf00`, using three fresh profiles:

| Sample | Renderer ready (ms) | Studio open (ms) | Studio summed working sets (KB) |
|---|---:|---:|---:|
| 1 | 1,352 | 386 | 686,332 |
| 2 | 1,332 | 211 | 711,036 |
| 3 | 1,279 | 463 | 688,920 |
| M0 investigation limit | 4,750 | 2,050 | 899,000 |

Every sample is within the M0 limits. Built output is 28,250,613 bytes; the lazy
Studio chunk remains 216,687 bytes. Raw [before](evidence/studio-m2-controls-before.json)
and [after](evidence/studio-m2-controls.json) data retain the slow samples as well
as the passing ones. These service-stubbed shell/UI measurements establish that
the click obstruction is gone; they are not controlled general speedup evidence
or real-media peak-memory measurements. Summed working sets can double-count
shared pages. Optional package size and expensive-media peak remain unmeasured.

Application and nine-shard matrix CI passed on preceding head `1090fdd`.
The final notification fix and evidence require fresh remote checks before merge;
the linked ledger records that outcome. HB-M2 and playable-video acceptance remain
open.
