# FINISH-MEDIA-QA-1 — source pictures before captions

Owner-authorized 27 September finishing pass. Fresh base `e4628326`, isolated
`claude/finish-media-qa-1`; no Ancient Pathways, provider, credential or artwork
changes.

## Reproduced defect

Actual six-second CPU H.264/AAC diagnostic: two seconds detailed content followed
by four seconds flat grey/black passed production `inspectRender` /
`evaluateRenderQa`. All-flat uncaptioned failed and all-detailed passed, proving
the probe discriminates. Adding burned captions to the all-flat movie made it
pass. Contact sheets were opened. Original evidence is retained outside git:
`.kilo/finish-20260927/media-diagnostics/qa-evidence.json` and the associated MP4s,
contact sheets and `reproduce-mixed-qa.mjs`. This is direct QA-seam evidence, not
creative/video-provider or full-episode acceptance.

## Correction

Storyboard reads each original picture before speech and overlays. A flat source
requires the user's reachable **Use a plain background for this shot** choice.
The choice is bound to the current image SHA-256: save validates it, reopening
clears stale hashes, and import/regeneration clears it even if replacement bytes
match. Detailed pictures remain unchanged; captions or a title overlay never
infer permission. The error names scene/shot and gives replacement/regeneration
or intentional-background actions. Any previous movie remains unchanged.

All-intentionally-plain boards retain export support, while ordinary final
decode, geometry, duration, audio and flat-output corruption checks remain. This
scope is Storyboard: ordinary-job source-picture intent and general creative QA
are not claimed.

## Verification checkpoint

Focused source/preflight, saved-state/export and reachable UI: 117 passing tests.
Compatibility across existing renderer/voice/frame-provider/shape/replacement
paths: 65 passing tests. Widget typecheck passes. Lint has zero errors and seven
existing unrelated warnings. Root: 232 tests pass; docs remain in sync.

Full widget check and actual built Electron acceptance pending at this checkpoint.
The opt-in `storyboard-source-qa.live.e2e.spec.ts` creates disposable authored
pictures, uses CPU FFmpeg with no narration/providers, rejects two blank shots
independently, retains the previous movie hash, checks explicit intent after
restart and records output/contact-sheet evidence. It needs the separately owned
sharp packaging correction for accepted render paths. No check is weakened and
the original failed evidence is retained.
