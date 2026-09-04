---
applyTo: "widget/src/renderer/**"
---

# Renderer UI rules

## Overlays escape by leaving the tree, not by z-index

`styles/chatgpt-theme.css` carries a blanket `.app-container > *:not(...)` rule at
specificity (0,12,0) that overrides `position: fixed` on any non-excluded child.
Separately, `.app-header` and `.chat-interface` set `container-type` and
`backdrop-filter`, and either one traps `fixed` descendants so an ancestor's
`overflow: hidden` clips them.

Portal overlays to `document.body` via `components/anchoredOverlay.tsx`. Only
extend that `:not()` list for something that must genuinely remain a child of
`.app-container`. Raising `z-index` does not fix this and reads like it should.

Thirteen overlays — including the file-permission prompt — shipped either
invisible or laid out as page rows with every unit test green. jsdom does no
layout and paints nothing, so Jest cannot see this class of defect at all. The
`overlay.e2e` and `tooltip.e2e` specs run inside the required `widget` job for
this reason.

## A control in `AdvancedSettingsTab` is invisible by default

Settings opens in **Simple**. `SettingsPanel.tsx` is a thin shell; state lives in
`settings/useSettingsState.tsx` and controls in `settings/*Tab.tsx`.

If a setting is something an ordinary user would look for on day one, put it in a
tab Simple renders (`ModelsSettingsTab`, `VoiceHotkeysTab`, `GeneralSettingsTab`)
or beside `PrivacySwitch`. This already shipped a live bug: the Claude
subscription option vanished from the default panel and was reported within
hours. Any test that reaches Diagnostics, System check or API Keys must click
**Advanced** first.

## Restate the mode union nowhere

Import `AppMode` from `shared/modes.ts`. `StatusIndicator.tsx` once declared it
three separate times, so adding a mode broke the build pointing at callers
instead of at the omission.

## Handoffs from chat

Panels reached by `navigate_to_mode` take an optional
`navContext?: Record<string, unknown> | null` and read only the keys they
understand — see `AutomationCenter.tsx`, `FeedsPanel.tsx`,
`workspace/WorkspaceShell.tsx`. Follow that shape rather than inventing a second
mechanism.

Apply the no-clobber guard **per field**, the way `AutomationCenter` does
(`setFormName(prev => prev || name)`), not as a single early return over the whole
effect. A guard on the whole effect means a second handoff into a panel the user
is already looking at is silently dropped, which is the dead end the handoff
exists to remove.

### One live instance of exactly that, unfixed

`WorkspaceShell.tsx:83` — `if (!open || root) return;` is the whole-effect form.

Leaving Code mode unmounts the component, so `root` resets and the next arrival
works. But when the user is **already in Code mode** and asks the assistant to
open a different project, `setMode('code')` is a no-op, the component stays
mounted, `root` is already set, and `navContext.path` is discarded with no
feedback. "Help me with this repo" silently does nothing in precisely the case
where someone is already looking at code.

The comment there cites "the AutomationCenter principle", but AutomationCenter
applies it per field and re-runs on every `navContext` change, so a second
arrival still fills anything blank. The stated justification is weaker than it
looks too: `setRoot` never clears `files`, so open tabs and unsaved edits survive
a root change — nothing is at risk of being yanked away.

Suggested shape when someone picks this up: honour the handoff when the incoming
path differs from the current root, and either repoint the tree or open the file
in place. Note there is **no test** — `navContext` appears in zero tests
repo-wide, so the `AutomationCenter` and `FeedsPanel` handoffs are untested too.
A test asserting what `navContext` does to `root` would be the first.
