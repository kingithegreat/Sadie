## Operating Rules (read first)
If a Notion connector is available, open "📚 Lessons & Playbook" under "Aden Brain", follow every rule, and APPEND any new lesson you learn. Always follow these baked-in rules:
1. Verify-fix gate: done only when the symptom is proven gone (reproduce → fix → prove; honesty A/B). Label verification level. Never claim a push/merge that didn't happen — confirm pushes with `git ls-remote`.
2. No stacking on unmerged work — build off main; merge stacks bottom-first.
3. Loop-breaker: if an action fails ~2× the same way, stop and change approach or escalate.
4. No filler: if the only step is padding or needs Aden (manual merge / credential / account), say so.
5. Complex planning uses the top model (Opus/Fable).
6. Name auto-mergeable branches `claude/**` (some repos gate CI/auto-merge on that glob). Persist work durably — never leave it only in a temp dir.
7. Credentials/accounts/payments are Aden's — never enter Stripe keys, create Play/Apple accounts, rotate tokens, or handle signing keys; flag them. A key pasted into chat is in the transcript forever: use it in memory only, never write it to disk, say so, and confirm the rotation happened. An app that encrypts a secret at rest must save it through its own save path — writing the file directly stores plaintext.
8. Verify where the code RUNS, not on this box. A container, CI runner or user machine is a different environment: `docker exec` the same request, read the container's own execution log. A scraper verified from the host returned an empty result in production for weeks of work.
9. Ask what reaches it. The dominant defect here is a capability that exists, is exported, is unit-tested, and that no production path calls. Before building on something, check the chain end to end: does the request route to it, is the tool offered, does the model get a prompt, does the branch that runs actually contain the fix.
10. When a fix changes nothing measurable, stop fixing and instrument. Print the assembled request, extract a frame, ask the DOM what is at that pixel, read the execution record. Layered gates hide each other, so "no improvement" is not evidence the fix was wrong — and never ship a change you cannot demonstrate.
11. A test that leans on a `__e2e_`/test-only hook may be testing the hook. Assert the real effect — requests made, file written, state left — and delete the hook once the test covers the real path.
