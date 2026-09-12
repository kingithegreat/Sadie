# UI palette and chrome — 13 September 2026

Owner request: colours did not match and the app looked too much like Windows.

The imported `homebot-palette.css` maps legacy palette aliases to one warm
charcoal / cream / sage system. It styles the existing reachable chat, Settings,
Studio cards/tabs, branding and composer, retaining semantic warning/error
colours and the media canvas. Both light and dark themes remain available.
Compact welcome cards now stay inside the window. No application logic,
providers, permissions, export settings or saved user data were changed.

## Verification

- Before: actual Electron screenshots showed blue branding, violet emphasis,
  blue Settings tabs and native-looking buttons together. Studio also had a
  hard-coded pale heading that was unreadable in light mode.
- After: `widget/src/renderer/e2e/ui-harmony.e2e.spec.ts` passes on Windows with
  a fresh profile and no retries. It uses Settings to switch themes, navigates
  Chat → Studio → Storyboard, checks heading contrast >= 4.5:1, matching chrome
  surfaces and Studio badges, enters text in the compact composer, checks both
  welcome cards fit, checks Settings Save stays in view, and tabs to a visible
  keyboard focus ring. Screenshots are in the test's Playwright output folder.
- Widget full Jest suite: 299 passed suites, 4,107 passed tests, 19 skipped
  tests before incorporating main #314. The sandbox run initially failed on
  fixture permissions; the Windows run with fixture access passed. Jest kept
  open handles after reporting its complete result and was stopped afterwards.
- Root Jest: 18 suites / 227 tests passed. Docs check passed.
- Widget typecheck passed. Lint: zero errors, eight existing warnings.
- After integrating main #314: build and typecheck passed; the renderer
  storyboard, multi-plane stage and theme-switcher suites passed; the complete
  visual Electron flow passed again.

Verification is local Windows development-build verification, not an installed
release or owner approval of the design. Media generation was not exercised by
this visual-only task. Existing build warnings about browser-external `path`,
mixed dynamic/static imports and outdated Browserslist data are unrelated.

## Handoff

Branch `claude/ui-harmony`; worktree `.kilo/worktrees/codex-ui-harmony`.
Owner approved the next integration step on 13 September 2026 after reviewing
the local implementation handoff. Publishing activates the existing
`.github/workflows/auto-merge.yml` workflow. The required build, export guard,
lint, permissions, widget and e2e-all checks must all be present and green
before merge. Installed-release acceptance remains separate.
