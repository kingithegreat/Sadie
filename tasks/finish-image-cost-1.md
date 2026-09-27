# FINISH-IMAGE-COST-1 — disclose and confirm paid image routing

## Reproduced

Based on fresh `origin/main` e4628326, in isolated branch `claude/finish-image-cost-20260927`.
Image mode advertised “Online — free, no account”, including its local-setup guidance, while
its direct IPC route preferred keyed paid Gemini and could fall back to paid OpenAI.
Storyboard's header advertised unconditional “free AI keyframe generation”.

The production reachability chain is ImageGenerator → executeImageGenerate →
homebot:automation:image:generate → gatedAutomationHandler → webToolHandlers.image_generate.
The Automation Center gate checks Pro entitlement; it does not run executeToolBatch or the
Studio gateway's confirmation wrapper. image_generate's definition did not require confirmation.

Four added dispatch regressions failed before the fix: missing/declined Gemini consent,
account replacement while approval waited, and declined OpenAI fallback. The recorded fixture
actually produced a paid OpenAI image after refusal. A separate background regression failed
after adding the paid gate: a consent denial still returned a fallback plate successfully.

## Changed

- Existing image IPC supports action=status, returning main-derived route labels, costs,
  Online state and paid fallback disclosure without provider calls or secrets. Best available
  discloses its local-first path and possible paid providers. Removed false unconditional free copy.
- Each paid dispatch calls ToolContext.requestConfirmation, connected to the existing
  requestConfirmationFrom sender bridge for Image mode. Missing/refused consent stops the entire
  fallback chain. A different paid provider requires its own approval. Saved account identity is
  compared only in memory immediately after the await, before generation. Renderer/tool arguments
  cannot provide approval. Standing storyboard first-use confirmation cannot approve this request.
- Reused storyboard Gemini cost/watermark language; OpenAI disclosure states usage-based billing
  without a price estimate. Actual paid metadata survives the panel IPC result.
- Existing assertProviderOnlineAccess guards cloud dispatch, paid approvals and Horde polls.
  Online-disabled errors propagate through Gemini/Horde/OpenAI rather than becoming a fallback.
  Gemini preference and the existing local/free provider order remain intact.
- media-visuals retains structured authority-denial codes. Paid-consent/account-change/Online-off
  denial stops scene generation instead of creating a placeholder or retrying. media_render keeps
  the response code and persists its existing failed export attempt with the actionable message;
  the previous successful movie remains selected and its bytes unchanged.

The saved error is reachable through MediaStudioPanel's job render action and StudioExportStatus's
“Why this attempt did not finish” details. The existing Studio run IPC preserves the message;
the panel also shows the immediate refused-stage error.

## Verification (local Windows source/handler/renderer evidence)

Final run: **211/211 tests across nine suites**, no skips or retries; Jest exits normally:
image-generate-tool, image-generator, ipc-registration, media-studio-storyboard,
storyboard-frame-provider, media-visuals, media-visuals-imagen3, media-render-qa-trust,
studio-export-status. These exercise the real handler and persisted temporary job store,
mock provider transport/encoding boundaries, and render the actual React components.

Coverage includes approved Gemini preference, separate paid fallback approval, account changes,
Online-off before dispatch/during approval/during a free queue wait, no paid or subsequent network
request on denial, main-derived cost disclosure, the real IPC sender bridge, background denial,
failed-attempt persistence, previous movie bytes, and reachable export error display.

Widget TypeScript --noEmit and changed-file ESLint exit 0. Root docs:write/docs:check are in sync
(247 preload methods, 182 renderer-to-main, 33 main-to-renderer channels). git diff --check passes.
Final logs are local ignored artifacts under this worktree's widget/image-cost-*.log.

One intermediate test timeout was traced to a new Horde fixture retaining an HTTPS mock job ID
into the next test: clearAllMocks clears call counts but not implementation. The suite now resets
HTTP/HTTPS implementations per test, and the complete final run passes normally.

### Current-main refresh (2026-09-27)

Merged `origin/main` `1f6fbc7bf4110c535a2d8cfdc56b793df8191136` in Codex-authored
merge `ac8e8509f2ebbb1056808421416fb81a3fcb271f`. Both independent claim rows
were retained. This refresh changes no production code versus the prior cost
head `de8ef30e`; main contributes test isolation only.

The same nine affected cost/authority suites plus the isolation regression pass
**213/213 tests across ten suites**, no skips or retries, exit 0 (58.042 seconds).
Widget typecheck and root docs check pass (247 preload methods, 182 R→M,
33 M→R). Log: `.kilo/finish-20260927/image-cost-main-targeted.log` in the shared
workspace. No build, Electron/provider call, model download or spending was used.
Root owns publication and integration; ART #430 remains held until #424 lands.

## Limits and next steps

No live provider request, key/account change, paid spending, microphone access, full suite,
build or Electron test was performed. Root owns independent review, coordinated full checks,
publication and integration. This lane does not replace or repair Pollinations's API contract.

The background media-visuals default generator has no interactive confirmation callback.
It deliberately fails closed if a paid provider would be selected; the error tells the owner
to use Image mode for an approved image or choose a provider on this PC. Wiring a supported
per-job paid confirmation route is separate work; no background consent was invented.

Ordinary network/generation failures still use the pre-existing placeholder/retry policy.
Its ability to produce low-quality placeholder scenes is a separate media-quality risk,
not changed or represented as resolved here.

## Separate documented Pollinations contract followup

Checked public primary docs on 2026-09-27; these are documentation requests, not generation requests.
The official [authentication recipes](https://github.com/pollinations/pollinations/blob/main/gen.pollinations.ai/src/docs/apidocs-recipes.md)
say: “Bearer key required unless the endpoint documents `?key=` support”. The relaxed exceptions
cover public media reads and model catalogues, not anonymous generation. Its OpenAI-compatible
base URL is gen.pollinations.ai/v1. The official [image generation contract](https://github.com/pollinations/pollinations/blob/main/gen.pollinations.ai/src/docs/image-generation.md)
documents GET gen.pollinations.ai/image/{prompt}, and states: “Returns JPEG, PNG, or SVG depending on the selected model.”
Community OpenAI-compatible generation uses /v1/images/generations and defaults to b64_json.

In contrast, the current Pollinations adapter at main/movie/pollinations-adapter.ts:19/33/71
declares anonymous generation available at zero cost without probing, posts to
api.pollinations.ai/v1/generate without Authorization, and expects a custom image field.
The shared storyboard picker and Movie Router card still advertise that path as free.
This is a **documented contract mismatch**, not an observed 401/404 or evidence that a live
request was made. Root must reconcile provider availability/setup/cost copy with the canonical
Drive plan before assigning a separate fix. This task changes no endpoint, provider or credentials.
