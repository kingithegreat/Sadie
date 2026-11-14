# Finishing audit — 28 October 2026 NZDT

Fresh main: 2d56b8e. Existing PR #496 contains the tested msedge-tts 2.1.0 narration fix. Reconciled both claim histories without altering that fix; runtime source and manifests exactly match its previous qualified af35a512 payload. No new provider, release, signing, paid call or owner profile.

Root TypeScript, all 233 root tests and docs drift passed. Widget TypeScript passed; lint has zero errors and 14 existing warnings. Focused compatibility/narration: 12 passed. Full Linux widget run: 6,127 passed, 19 failed, 78 skipped; 460 passed suites, six failed, 19 skipped. Full suite is not green: URL/feed network timeouts, sandbox networkInterfaces failures in system/licensing, Windows-only sd-cpp setup and Windows-path assumptions in search. This environment does not qualify Windows installation or owner voice/Pro acceptance.

Exact-head 87ee834 hosted jobs exposed an independent runner regression: run 40557265706/job 122376551944 and run 40557265805/job 122376552722 fail during Playwright installation, before any browser test. Runner is Ubuntu 26.04; error: Playwright does not support chromium on ubuntu26.04-x64. Both browser workflows now use Ubuntu 24.04. No browser/library upgrade or test gate removal; Windows/macOS, all three shards, timeout/retry behavior and required e2e-all remain intact.

Validation: parse both YAML workflows, check the installed pinned Playwright distribution contains Ubuntu 24.04 Chromium support, run root tests/docs and inspect fresh hosted installation/tests. Windows installer, E2E, real media and owner acceptance remain separate scopes. Earlier af35a512 had six required contexts, installer and real narrated render evidence; it does not make new pipeline results green.
