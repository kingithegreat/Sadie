# Cline rules — `widget/` hotspots

Six rules that every automated gate is green for. Copilot receives these
automatically, scoped by `applyTo` glob, from `.github/instructions/`. Cline has
no equivalent mechanism — it loads this folder as one always-on ruleset — so the
short form lives here and the full reasoning stays in those files:

- `.github/instructions/renderer-ui.instructions.md` — `widget/src/renderer/**`
- `.github/instructions/main-tools.instructions.md` — `widget/src/main/tools/**`
- `.github/instructions/widget-verification.instructions.md` — `widget/**`

Read the matching one before editing under that path. Each was written from a
defect that shipped.

## Editing `widget/src/renderer/**`

**Overlays escape by leaving the tree, not by z-index.** `styles/chatgpt-theme.css`
carries a blanket `.app-container > *:not(...)` rule at specificity (0,12,0) that
overrides `position: fixed` on any non-excluded child, and `.app-header` /
`.chat-interface` set `container-type` and `backdrop-filter`, either of which traps
`fixed` descendants so an ancestor's `overflow: hidden` clips them. Portal to
`document.body` via `components/anchoredOverlay.tsx`. Only extend the `:not()` list
for something that must genuinely stay a child of `.app-container`.

Raising `z-index` does not fix this and reads like it should. Thirteen overlays —
the file-permission prompt among them — shipped invisible or laid out as page rows
with every unit test green. jsdom does no layout and paints nothing, so Jest cannot
see this class of defect at all; `overlay.e2e` and `tooltip.e2e` run inside the
required `widget` job for that reason.

**Import `AppMode` from `shared/modes.ts`.** Never restate the union.
`StatusIndicator.tsx` once declared it three separate times, so adding a mode broke
the build pointing at callers instead of at the omission.

**Chat handoffs use one shape.** Panels reached by `navigate_to_mode` take an
optional `navContext?: Record<string, unknown> | null` and read only the keys they
understand — see `AutomationCenter.tsx`, `FeedsPanel.tsx`,
`workspace/WorkspaceShell.tsx`. Follow it rather than inventing a second mechanism.
Apply the no-clobber guard **per field** the way `AutomationCenter` does
(`setFormName(prev => prev || name)`), not as one early return over the whole
effect — a whole-effect guard silently drops a second handoff into a panel the user
is already looking at, which is the dead end the handoff exists to remove.

## Editing `widget/src/main/tools/**`

**Every model-facing tool needs a permission entry.**
`__tests__/tool-permissions-parity.test.ts` is the gate: every native tool needs
either a permission entry or `requiresConfirmation`, and every permission key needs
a tool. It exists because `navigate_to_mode` shipped with neither and executed via
`assertPermission`'s `!requiresConfirmation` default. Adding a tool means touching
`main/config-manager.ts` defaults and the user-facing copy in
`renderer/components/settings/useSettingsState.tsx` in the same change — run the
parity test, it will tell you which you missed.

**Reuse the boundary utils.** Path and URL confinement live in
`main/utils/home-boundary.ts` and `main/utils/url-boundary.ts`. Five hand-rolled
`startsWith` guards had already drifted apart before they were replaced, and a
sixth is how the next escape ships. Do not re-derive "is this path safe" locally.

**Shell out via argv, never a shell string.** `grep_code` and the git tools run
through `execFile` with an argv array. That is what removed the `cmd.exe` injection
surface in `file_pattern` and the commit path. Keep it.
