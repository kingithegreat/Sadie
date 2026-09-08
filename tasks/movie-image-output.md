# Movie image outputs — HB-M2 / media task 2

Branch: `claude/studio-movie-artifacts`, from merged main `19535cb` (#266).
Scope: durable, readable image results through the existing Studio module.

## Change and reachable behavior

Pollinations, Imagen and Stable Diffusion discarded their base64 results and
returned `done` with an empty file list. ComfyUI saved arbitrary response bytes
as PNG. The router accepted those results, and the runner recorded and reused
`IMAGE_GENERATED` without inspecting a file.

All four shot adapters now share `movie/image-output.ts`: decode PNG/JPEG with
Electron's existing native image API, choose the extension from the bytes, and
write a complete temporary file before replacing the shot image. Invalid
input does not replace an existing image. The output directory stays within
the home/shot boundary, including existing junctions; shot IDs cannot be paths.
Encoded files are bounded to 32 MB. This adds no image library or worker.

The router validates image files before accepting `done`, so an unusable result
can follow the existing fallback policy. The runner also checks image output
at completion and before accepting a cached, approved or deferred image.
Saved output references are relative to the shot folder. Legacy projects can
find their canonical PNG/JPG image. Missing or unreadable saved images become
`FAILED` with an actionable message; files remain available for inspection.

Reachability: **Studio → Movie Router → Route & Generate → existing preload /
trusted Studio IPC → MovieProjectRunner → GenerationRouter → image adapter →
saved file → persisted state → visible success/error**. The chat movie tool
uses the same runner. No new pipeline or Core/provider coupling was added.

## Local evidence (Windows, 2026-09-09)

- `widget/src/main/__tests__/movie-image-output.test.ts`: 15 regression failures
  reproduced before the implementation, then 15 passed. Expanded coverage now
  passes 23 tests: persistence, corrupt data, empty/missing/directory/outside-shot
  files, valid output, fallback, cache/deferred failure, junction confinement,
  unsafe IDs and preserving a previous image. Node uses an explicit decoder
  double; it is not proof of real Electron decoding.
- Existing adapter/router/runner tests now use actual image bytes instead of
  text pretending to be PNG. Six focused suites passed 53 tests before the
  additional eight guard/control cases; the final 23-case output suite passed.
- Full widget suite: **272 suites / 3,850 tests passed**, 5 suites / 15 tests
  skipped, using the existing CI `--forceExit` setting. Root: **18 suites /
  226 tests passed**. Both typechecks, build, docs and duplicate-export guard
  passed. Lint: zero errors, eight existing hook warnings.
- `widget/src/renderer/e2e/movie-image-output.e2e.spec.ts` plus
  `movie-provider-privacy.e2e.spec.ts`: **4 passed, no retries**, rebuilt Electron,
  fresh profiles, controlled real HTTP server, actual Studio clicks. PNG and
  JPEG decode to 256×256 with four distinct sampled color regions. Exact saved
  bytes match the server; cached reruns make no second generation request;
  corrupt responses and subsequently damaged files produce visible/persisted
  failure. The Online denial still observes zero provider requests.
- Initial PNG E2E timed out while routing. A nonexistent Ancient Pathways
  override allowed fallback discovery of the installed engine. The corrected
  fixture provides a real directory with an active render lock, preventing
  unrelated generation. The final traced run passes in 1.1 minutes without
  changing product timeouts or weakening assertions.

The fixtures prove real transport, decoding, storage and visible failure
propagation. They do **not** prove live AI-provider output, image sizing/reference
fidelity, pricing/free-tier availability, creative quality, video decoding,
placeholder-video rejection, narration or the HB-M2 pilot. Those remain in
the current Notion/media plan. No cloud credentials, payments or publication
were used. Remote CI and merge are pending at this committed checkpoint.
