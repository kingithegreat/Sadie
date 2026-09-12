# Studio output contract and sole-owner handoff

Owner: Codex. Aden confirmed on 2026-09-13 NZ: "ok its all you now" after
being asked to pause Antigravity's Studio work. Work starts from main c90f077
on claude/studio-output-contract in the isolated completion checkout.

The previous recovery is merged as #314; its last-good output, all-scene,
offline speech and project/review identity regressions must remain intact.
The #313 branch at 3a6f6d7 and the shared checkout's uncommitted CLAIMS.md and
MEDIA_STUDIO_PLAN.md are preserved. Unique partial ratio plumbing and CSS are
reference material; the old renderer's manifest/single-scene behavior is not
restored. Follow the canonical Notion HB-REPO-314 sequence, not a wholesale merge.

First acceptance: persist an explicit captions choice on new and existing
productions, expose it in the ordinary Studio workflow, pass it across actual
IPC, and keep scene timing separate from burned-in captions. Intentionally
captionless movies must pass otherwise-valid QA without an SRT; caption-enabled
movies retain caption validation. Default new productions to captions off.
Preserve existing projects' legacy behavior until explicitly changed.

Then complete versioned ratio/duration/framing/output variants, truthful export
revision and latest-attempt state, stage/export parity and the existing workspace.
Real encoded output and restart/failure tests precede acceptance claims.
Complete owner-approved pilot, installed-build verification and owner visual
approval remain distinct gates. No paid generation, credential change or upload.

Keep #316's active nightly/timeline repair, the UI-harmony worktree, #309/#310
documentation lanes and all unrelated work intact. Pin Codex identity on every
commit command because repo-local configuration is shared by worktrees.

## Caption checkpoint (local, not production acceptance)

Seven initial failing assertions were reproduced, then 107 targeted tests passed.
Further regression coverage protects scene generation/timing with burn-in off,
rejects edits and duplicate renders during an export, and releases that lock on
failure. The review queue receives the caption choice actually rendered rather
than metadata reread after rendering. Both TypeScript checks and docs parity
are clean at this checkpoint; paired live caption-on/off export proof and full
application checks are still pending.

The separate Ancient Pathways/Showrunner Python bridge does not accept HomeBot's
caption option. Its jobs (including legacy history records) explicitly say that
caption settings belong to that external renderer, and cannot use the new
control. No caption-free claim is made for that route. Do not silently label an
uncontrolled external export with the new default. Bridge parity remains open.

The root/main nightly repair #316 merged during this work. Integrate its uniform
image format and whole-narration timeline fixes before final combined testing.
