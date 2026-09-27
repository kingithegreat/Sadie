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

Merge dependency: land this new regeneration route **after #424**, whose
authoritative background image-generation denials preserve privacy and paid
provider consent. This branch remains based on fresh main, with no unmerged
image-cost stack; the nearby `media.ts` structured-error catch will be reconciled
at integration. Current main `1f6fbc7b` (test isolation only) is merged for the
final targeted verification.

After that merge, the five targeted source-art, real-handler recovery, typed IPC,
reachable UI and per-file isolation suites pass **66/66 tests**, and widget
typecheck passes. Log: `media-diagnostics/art-main-targeted.log`. No product code
changed after the actual built proof; main added test isolation only.

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

Actual built normal UI acceptance passes **1/1, zero retries, 49.8 seconds**.
Own branch includes main `055f355d` and runtime Sharp declaration; no verification
overlay was used. The supported automatic encoder selected `h264_nvenc`.
Both exports decode as 1280 x 720, 30 fps, 180 frames, exactly six seconds;
their AAC audio also covers six seconds. The cache control made zero generation
POSTs. Cached production failure-plate bytes were refused with scene 1 guidance
and `SCENE_PICTURE_FAILURE`. Explicit regeneration made two loopback POSTs:
flat response refused, detailed response accepted into a separate export path.
The old movie and cache bytes remained unchanged. After restarting the actual
app, the recovered player loaded and advanced beyond 0.2 seconds.

Evidence: `.kilo/finish-20260927/media-diagnostics/art-live-settled/`
`studio-scene-source-qa.liv-8eadb-d-preserves-the-good-export/`.
Both contact sheets were viewed across start/middle/end: authored diagnostic
artwork with burned captions, no empty background. Failure guidance was viewed.
Movie SHA256 (both intentionally identical authored controls):
`06bf2a13c85ca36e77fcaa6537a234598d65b90ce53d09929b0a459c0bf2d40c`.
Evidence JSON SHA256:
`0faa4324344c18cf13a4f70356119aee7daa9fc4621e730fffd46b6e09b715a6`.
Contact sheet SHA256:
`6d5d923dd78d9e8d25b8d39801d3a6626f7357280cab87c6719c7a3f7dc48fd8`.
Failure guidance SHA256:
`b6dec140d44b3cb217f3a3b831c20a94e4efbbbe02198e5f72f00c2627720b72`.

First run retained in `art-live/` and `art-live.log`: the detailed export
succeeded, but the harness awaited multi-format wording for the single-format
path and timed out. Corrected selector waits the real `Rendered` result and no
working indicator before closing. Closure instrumentation targets only the
test's own Electron process, with a ten-second bound; all three corrected-run
closures completed without that timeout. This is fixture/content acceptance,
not a claim that a real provider, model, voice or creative production was tested.
