# FINISH-MEDIA-ART-1 — ordinary scene pictures before captions

Codex, owner-authorized 27 September 2026. Fresh base `e4628326`, isolated
`claude/finish-media-art-1`. Root owns integration and the build/render queue.
The image-cost worker owns image-provider authority changes; this task does not
edit `media-visuals.ts` or its dispatch routes. No AP/art/credential changes.

## Reproduced defect

Normal Director job **Make the video** calls `mediaRun(render)` without a visual
override; IPC routes to `media_render`, whose default `scenes` mode requests
scene images with fallback plates enabled. Failed generation becomes a real
dark solid PNG. The preparation stage counts the plate as an image and drops
generation provenance when persisting paths. Captions can supply enough pixel
variation for final QA to approve missing scene art. Enabling captions does not
express consent to a title card or a plain background.

Direct production-seam evidence outside git:
`.kilo/finish-20260927/media-diagnostics/ordinary-fallback/evidence.json` and
`ordinary-fallback-repro.cjs`. Actual injected failure generated three production
fallback PNGs; actual production timeline arguments burned ordinary captions;
actual `inspectRender` / `evaluateRenderQa` measured:

- Detailed plus captions control: pass, variation about 63.7.
- Failed fallback plates without captions: fail, variation 0–0.174.
- Same failed plates with captions: pass, variation 11.23–14.53.

All six seconds, 1280x720, audible synthetic sine at -21.1 dB. All contact sheets
were opened. Captioned failed-art MP4 SHA-256:
`e576157dd6433686a940ceeef3272a7f3437206f982ed984fc5c8e1f6390cbdb`.
This is a direct seam reproduction, not complete UI/voice/creative acceptance.

## Correction and scope

Default-scenes preparation validates every frozen source picture before
`fillMissingImages`, concat or captions. It refuses missing files, failed
generation/fallback provenance, undecodable bytes and flat pictures. Existing
shared `grabFrame`, `contentStdDev` and flat threshold are reused. Cache and
reused sources are decoded too, so provenance loss cannot make a plate pass.
Errors identify the scene number and ask to replace or regenerate scene art.
Neighbour substitution cannot conceal a missing scene.

Explicit `visuals=plain` and explicitly supplied artwork retain their existing
behavior. Final decode/audio/duration gates and atomic last-good storage remain
unchanged. This does not claim semantic image quality, animation quality or
voice quality.

Source-QA failures use the shared `SCENE_PICTURE_FAILURE` identifier, persisted
and sanitized in the failed export attempt. Only that identified failure offers
**Regenerate scene pictures** in the normal job. Its typed IPC/tool flag bypasses
saved scene reuse and generated-image cache for that invocation; it deletes no
cache/source/movie files and cannot reinterpret explicit plain/supplied artwork.
Current privacy and payment rules still apply, with no inferred paid consent.
Public API behavior is documented in `docs/api-reference.md`.

## Verification checkpoint

Before edits: ordinary render trust suite 31/31 passed. After correction:
source helper / render trust / renderer 101/101 passed; compatibility across
media tools, scene generation and output IPC 90/90 passed. Widget typecheck
passes; lint has zero errors and seven existing unrelated warnings.

Recovery checks: 63 tests across source helper, real handler/store, IPC and
normal UI pass. They prove rejected reused art reaches generation again with
cache bypass, preserves originals/last-good on paid denial, and accepts corrected
art. Unrelated provider text cannot offer the recovery action. Export-state,
output-format and status compatibility: 32 pass. Typecheck/lint/docs pass.

The opt-in `studio-scene-source-qa.live.e2e.spec.ts` exercises normal **Make the
video** with an isolated generated-image cache. A detailed control exports, then
retained actual production failure-plate bytes injected into that cache are
refused. Explicit regeneration reaches actual generator transport into a bounded
AUTOMATIC1111-compatible loopback fixture: first response flat (refused), second
detailed (accepted). Request counts, unchanged cache/old-movie hashes and restart
playback are asserted. It refuses an occupied fixture port rather than touching
an owner's service. No test-only product hook or real provider/model call is
introduced. Fresh generator failure is covered separately by the direct seam
reproduction and handler unit test.

Actual built acceptance pending the coordinated render lane. The bounded
six-second default auto encoder is authorized; chosen encoder is recorded.
