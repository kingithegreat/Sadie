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
