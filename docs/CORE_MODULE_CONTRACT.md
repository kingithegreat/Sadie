# HB-M1 — trusted bundled module contract v1

This is the versioned implementation of HB-M1 in the
[locked Notion Core + Modules plan](https://app.notion.com/p/3d5829ebf7be8150abd0f56e4d00083d).
The [measured HB-M0 baseline](CORE_MODULE_BASELINE.md) records the original
architecture and performance limits. Existing media acceptance gates remain in
[MEDIA_STUDIO_PLAN.md](MEDIA_STUDIO_PLAN.md).

## Runtime boundary

The Electron desktop still has one tool Map and one permission executor.
`widget/src/main/tools/registry.ts` extracts the Map previously in `tools/index.ts`.
The original exports remain available from `tools/index.ts`, including
`executeTool` and `executeToolBatch`. Core tools retain their previous behavior.
The separately tested root `src/toolRegistry.ts` is not the desktop dispatcher.

`main/modules/host.ts` owns reviewed bundled registrations. Its injected services
are tool registration, invocation through Core, existing capability-grant checks,
platform identity and local lifecycle logging. A module receives its frozen
manifest, registration and cleanup hooks, and invocation through the existing
executor. No new scheduler, credential store, paid authority or runtime is added.

The trusted composition root is `main/modules/bundled/`. It installs the
`homebot.production-studio` descriptor at existing IPC/tool initialization and
owns all six existing Studio tool groups. Engines, assets, jobs and provider
implementations remain in their original locations. Startup catches a failed
Studio activation so the Core shell can continue; later initialization does not
silently re-enable a disabled or failed module.

## Data contract

`shared/modules/contracts.ts` and `manifest.ts` define and validate schema v1.
All fields are required unless explicitly marked optional in the type. Unknown
keys, wrong types, duplicates and invalid nested fields are rejected. Parsing
produces a detached, recursively frozen manifest.

| Field | Meaning |
|---|---|
| `schemaVersion` | Exactly `1`; independent of the package and host versions. |
| `id`, `publisher`, `version` | Namespaced identity, display attribution and a stable `major.minor.patch` release. A publisher string does not establish trust. |
| `hostApi` | Explicit inclusive `min` and exclusive `maxExclusive` stable versions. No prerelease, wildcard or implicit range interpretation in v1. |
| `display`, `platforms` | Name/description and supported operating systems. |
| `dependencies` | Required module IDs and the same explicit version-range format; missing, incompatible and cyclic dependencies fail preflight. |
| `optionalIntegrations` | Informational availability hints, not required services or permission grants. |
| `contributions` | Namespaced command/view/settings/provider declarations. M1 supports commands; other nonempty contribution types are rejected until implemented in M2. |
| `permissions`, `grants` | Requested existing Core authorities. Every registered tool's name and required permissions must be declared. These fields cannot grant themselves access. |
| `resources`, `dataSchemaVersion` | Hardware hints and a positive data-schema version. These are not an implemented lease scheduler or migration engine. |

Activation code is separate from the data manifest and compiled into the reviewed
bundle. No path, URL, entrypoint, credential or arbitrary JavaScript in a manifest
is loaded. This is an internal contract for trusted first-party code, not an
untrusted-code sandbox or independently downloadable plugin format.

## Registration and lifecycle

Installation preflights the complete bundle before installing any descriptor.
Activation is synchronous registration work; I/O belongs in invoked jobs.
Each command must be declared, registered once and collide with no Core or module
tool. Public legacy tool names stay unchanged; ownership adds a namespaced
capability ID and generation number. Identity-aware unregister hooks cannot
remove a later registration with the same public name.

States are `disabled`, `enabling`, `enabled`, `draining` and `failed`. Failed
activation rolls back acquired registrations/resources. Disable stops new calls
and removes tool exposure immediately. Already-started handlers drain with their
resources retained; resources are then disposed before re-enable is allowed.
Disposal failure is reported and prevents unsafe restart of possibly leaked
resources. Dependents must stop before their dependencies. Uninstall only removes
disabled descriptors and never deletes projects or assets.

Every owned handler captures its generation. This also guards handlers retained
by a pending permission/confirmation prompt, including the batch executor's
one-use override path. Consent for an earlier generation cannot execute a later
registration. Required grants are rechecked at invocation using existing Core
capabilities; Studio requests no new paid grant.

Errors carry stable codes such as `INVALID_MANIFEST`, `DEPENDENCY_CYCLE`,
`DUPLICATE_CONTRIBUTION`, `MODULE_UNAVAILABLE`, `ENTITLEMENT_DENIED` and
`DISPOSAL_FAILED`. Local lifecycle JSONL contains module identity/version and
state transitions, with no network telemetry or provider credential material.

## Reachable Studio facade

The existing Studio button mounts the existing lazy renderer panel. Its preload
calls reach the same 27 literal media IPC channels, now composed in
`bundled/studio-ipc.ts`. `studio-gateway.ts` requires the actual HomeBot window's
webContents and main frame, validates argument arity/basic types, derives module
identity from main and checks module state before entering a handler.

Tool-backed operations such as scripting, narration, rendering, deletion and
storyboard creation run through Core's existing batch permission executor.
One-use approval uses the existing confirmation UI, is tied to the captured
registration, and does not change saved permissions. Legacy response fields,
tool names and channel identities remain compatible.

The IPC channels themselves remain registered for compatibility. Their guards
return `MODULE_UNAVAILABLE` while Studio is disabled; tool registrations are
physically removed. This avoids the existing global IPC registration patch's
duplicate-channel bookkeeping. The Modules screen and UI contribution removal
belong to HB-M2, so M1 does not claim user-facing optional installation.

The facade does not complete the provider/security migration: direct domain
state operations retain their existing policies, nested storyboard path fields
still need containment validation, and provider privacy/availability must be
completed through this boundary in M2. Persistent job cancellation, restart
recovery, heavy asset packaging and process shutdown policy remain M3. Existing
project data is retained throughout this change.

## Import and verification gates

`scripts/check-module-boundaries.cjs` walks TypeScript syntax for imports,
re-exports, `require`, dynamic imports and import types. Required root Jest runs
the real-tree guard plus deliberately forbidden and permitted fixtures; nonzero
file/import counts prevent an empty scan from passing. Core cannot import Studio
implementation outside reviewed bundled composition. Two exact existing seams
are documented in the script: App mounts the lazy Studio panel, and the generic
image tool reuses the ComfyUI adapter pending a shared provider contract. Bare
package specifiers are external; no current internal alias targets Studio.

Contract tests use a small reviewed module and the actual registry. They exercise
collision/compatibility/dependency rejection, rollback, unregister, drain,
generation races and grant revocation. IPC tests assert real temporary disk
state under invalid sender/payload, denied deletion, disabled Studio and restored
registration. The fresh-profile Electron test clicks Studio and creates a real
storyboard, verifying files and Core tool-executor telemetry. Provider requests
are outside this evidence; a created storyboard is not a rendered video.

Final local/remote verification and measured comparison are recorded in the PR
and Notion only after the relevant checks complete.
