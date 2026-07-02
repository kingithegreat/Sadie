## Operating Rules (read first)
If a Notion connector is available, open "📚 Lessons & Playbook" under "Aden Brain", follow every rule, and APPEND any new lesson you learn. Always follow these baked-in rules:
1. Verify-fix gate: done only when the symptom is proven gone (reproduce → fix → prove; honesty A/B). Label verification level. Never claim a push/merge that didn't happen — confirm pushes with `git ls-remote`.
2. No stacking on unmerged work — build off main; merge stacks bottom-first.
3. Loop-breaker: if an action fails ~2× the same way, stop and change approach or escalate.
4. No filler: if the only step is padding or needs Aden (manual merge / credential / account), say so.
5. Complex planning uses the top model (Opus/Fable).
6. Name auto-mergeable branches `claude/**` (some repos gate CI/auto-merge on that glob). Persist work durably — never leave it only in a temp dir.
7. Credentials/accounts/payments are Aden's — never enter Stripe keys, create Play/Apple accounts, rotate tokens, or handle signing keys; flag them.
