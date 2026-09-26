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

Full widget sandbox run: 336 suites / 4600 tests passed; eleven suites failed
with the same permission/subprocess/fixture failures independently reproduced on
the base by root. Root owns their isolated rerun; this task does not claim that
full suite green. Logs are retained in the diagnostic directory.

Actual built Electron acceptance **1/1 passed, retries zero, 1.8 minutes**.
`storyboard-source-qa.live.e2e.spec.ts` created disposable authored pictures,
CPU FFmpeg with no narration/providers: detailed control exported; flat shots
002 and 003 each rejected until explicitly acknowledged; original movie hash
survived rejection and accepted replacement. On restart, both choices persisted
and the saved movie decoded and played. Replacing shot 002 bytes at the same path
cleared its choice and rejected export while retaining the accepted movie hash.
FFprobe: six seconds, 1920x1080, H.264 30 fps, AAC 48 kHz stereo silence. The
contact sheet was visually opened and contains the expected detailed/grey/black
sequence. This is functional QA acceptance, not creative or voice quality proof.

Evidence outside git:
`.kilo/finish-20260927/media-diagnostics/source-qa-live-settled/`
`storyboard-source-qa.live.-d3b1b-thout-losing-the-good-movie/`
contains `source-qa-evidence.json`, `explicit-plain-contact.png` and reopened
screenshot. Original SHA-256:
`bfd764db4cb4a8569854bc1d8a57dba0719c9024297df425de130443030ebaf9`.
Accepted SHA-256:
`a783ae450ca546481fccb96abb0b4bd577cc389cb46e3c69bfde562e7f2f8a11`.
Project retained under the isolated home
`C:\Users\adenk\AppData\Local\Temp\homebot-source-qa-AjmCPE\projects\source-qa`.

The first actual run timed out while closing immediately after the on-disk
success appeared. Its evidence remains in `source-qa-live/`. The changed harness
awaits visible successful-render status and an enabled Render button before
closing, records close boundaries, and completed all four launches. No product
check was weakened. Built accepted paths used the separately owned exact Sharp
runtime-dependency overlay (`ad2a2d616e7e41113a19abf93e7877a0b7e1c48e`); it was
removed from this branch's source after verification and must land independently.
