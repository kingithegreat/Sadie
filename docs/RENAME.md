# SADIE → HomeBot rename — state and remaining steps

The product has shipped under two names. This PR finishes the in-repo sweep;
what's left is deliberate, listed here so nobody "cleans it up" by accident.

## Done in this PR (Tier 1 — zero risk)
- All user-visible strings: permission copy, PermissionModal, TrustPanel,
  SettingsPanel, DashboardPanel, AutomationCenter, "HomeBot Pro" tier title.
- Upgrade sentinel `sadie://upgrade` → `homebot://upgrade`. AutomationCenter's
  dead-link check accepts **both** values because pre-rename builds persisted
  the old sentinel to disk — do not remove the legacy comparison.
- CRM actor defaults `'sadie'` → `'homebot'`. Actor is free text in SQLite;
  rows written by old builds still say `sadie` and render fine. No migration.
- Docs prose, code comments, `.env.example` comments, sse-proxy lockfile name,
  LICENSE holder, test fixtures. Orphaned `widget/temp-trace/test.trace` deleted.

## Deliberately KEPT (do not sweep)
- `github.com/kingithegreat/Sadie` clone/release URLs — true until the repo is
  renamed (below). Sweeping them first would break the docs.
- The legacy sentinel comparison in AutomationCenter (above).
- `Notion → SADIE (legacy name) →` pointer in entitlements.ts — the Notion page
  is still titled that.
- One historical note in README tying HomeBot to the SADIE capstone — this is
  what lets an employer match the repo to the Toi Ohomai transcript PDFs.
- Git history, old issue/PR text: immutable, fine.

## Tier 2 — repo rename (Aden's call, ~2 min, do AFTER v1.1.0 tags cleanly)
1. Repo → Settings → rename `Sadie` → `HomeBot` (GitHub redirects old URLs and
   `git remote` operations indefinitely, so nothing breaks immediately).
2. Follow-up PR: update clone URLs in README / docs/setup-guide /
   DEVELOPER_BUILD_GUIDE / RELEASE_PROCESS and `repository.url` in
   widget/package.json.
3. Update Notion links + bench-mcp config if it pins the repo name.
4. Local machines: `git remote set-url origin https://github.com/kingithegreat/HomeBot.git`
   (works before doing it too, thanks to the redirect).

Timing note: rename between the v1.1.0 tag and starting Phase B, so release
artifacts and the tag both carry one consistent name story.
