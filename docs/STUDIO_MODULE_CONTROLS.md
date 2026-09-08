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
  grant rejection, corrupt preferences and unknown module identity.
- `widget/src/main/__tests__/module-control-ipc.test.ts`: sender/frame and payload
  validation before controller dispatch.
- `src/__tests__/module-boundaries.test.ts`: real-tree import scanning plus an
  explicit rejected App-to-Studio import.
- `widget/src/renderer/e2e/module-controls.e2e.spec.ts`: real fresh-profile Electron
  clicks Disable, verifies absent navigation/tools and denied Studio IPC, restarts,
  verifies the saved choice and retained files, enables Studio, and creates an
  actual storyboard through Open Studio. No media provider success is mocked.

Initial local Windows checks passed 44 focused module tests and two real Electron
tests without retries, including the existing Studio-to-disk regression. The
complete unit/static/CI checkpoint is recorded in the claims ledger and Notion.
Creating a storyboard proves reachability and file persistence, not playable video.
