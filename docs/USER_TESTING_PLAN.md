# HomeBot — plan to user testing

**Owner:** Aden. **Reconciled:** 2026-09-20, from `origin/main` at `c2614b2` and live GitHub PR/issue state. The prior status pass in PR #385 was based on an older main and conflicted; this document supersedes it.
**Goal (Aden, 2026-09-17):** every feature complete and working end to end, so the app is ready for hands-on user testing. That means a user can customise and edit anything in Media Studio and get exactly the video they want, and Code mode offers what Cursor offers.

This is the shared work queue for every agent (Claude, Codex, Gemini, Antigravity). It sits on top of the existing plans, not beside them:

- [`MEDIA_STUDIO_PLAN.md`](MEDIA_STUDIO_PLAN.md) keeps its eight acceptance gates. Items below cite the task they serve.
- [`CORE_MODULE_BASELINE.md`](CORE_MODULE_BASELINE.md) and the Notion locked M2 plan still own architecture.
- [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md) and [`CLAIMS.md`](../CLAIMS.md) govern how work is done.

## How to work from this plan

1. **Pick the highest open item whose dependencies are merged.** Gates (G) come first: until they are green, no other result can be trusted.
2. **Check before you build.** Look for an open PR or a `CLAIMS.md` row on the same ID (`gh pr list --state open`). If one exists, help land it instead of writing a second version.
3. **Put the ID in the branch and PR title,** e.g. `claude/ms-3-caption-style`, `feat(storyboard): MS-3 caption style`. One item per PR.
4. **Done means the "Done when" evidence exists,** with the verification level stated (unit, real FFmpeg, real Electron, installed build). A unit test through a mock is not proof that a video changed. Render it and measure the file.
5. **When your PR merges,** change only your item's Status cell here, in a small follow-up. Never rewrite other rows.
6. **Stop and ask Aden** for anything under "Needs Aden": keys, accounts, payments, publishing, or a product decision the plan does not already record.

Status values: `open` · `PR #n` · `merged #n` · `needs Aden` · `blocked by <ID>`.

## This machine (the setup we optimise for)

| | Measured 2026-09-17 |
|---|---|
| CPU | Intel Core i5-12450H, 8 cores / 12 threads |
| GPU | NVIDIA GeForce RTX 2050, **4 GB VRAM** (plus Intel UHD) |
| RAM | 15.7 GB |
| FFmpeg | managed n9.0 build. Encoders present: `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`, `h264_qsv`, `libx264`. **Studio renders use `libx264` (CPU) only.** |
| OS | Windows 11 |

Consequences:
- Local image generation must fit in 4 GB. SD 1.5 fits but is capped at 512 px. Larger models need quantised builds (see #296, sd.cpp) or Colab.
- Hardware H.264 encoding is available and unused.
- Heavy video models belong on Colab (MEDIA_STUDIO_PLAN Task 4), not this GPU.

---

## G — Gates that must be green before "ready for user testing"

| ID | Problem (evidence) | Done when | Status |
|---|---|---|---|
| G-1 | **Release Gate was red, then stopped running on main at all.** #355 moved the gate to Windows (fixed the Linux home-boundary `filesystem.test.ts` failures). But it only fired on `push: [main]` + a `paths`-filtered `pull_request`, and every merge since 2026-09-16 09:30 was a bot squash-merge with the repo `GITHUB_TOKEN` — GitHub does not fire `push` events for `GITHUB_TOKEN` pushes, so the gate was dark for 30 consecutive merges while still looking green on its own PR branch. Fixed by #377 (daily `schedule` 06:00 UTC + `workflow_dispatch` + a `concurrency` group). | Trigger fixed and verified: scheduled main run `35438194068` on 2026-09-19 is green. | merged #377; one scheduled green observed, three-consecutive requirement still open |
| G-2 | **Nightly Media E2E red 5 nights running** (2026-09-12 → 16). Run 35068419377, Windows: `media-render.live.test.ts` and `studio-real-ipc.test.ts`, 7 failed / 63. One case expects "install / winget / ffmpeg.org" guidance but gets "has no narration audio yet — run media_narrate first", so a precondition check fires before the ffmpeg check. Read each failure; don't label any of them flaky until the exact error text is diffed. | Each of the 7 failures is explained and fixed (product or test, stated per case). Nightly green 3 nights running. | merged #387; scheduled runs `35318304278` (Sep 18) and `35428550024` (Sep 19) are green — 2/3 consecutive, with the third still open |
| G-3 | **Issue #229:** the full widget suite is nondeterministic; a different suite fails per run, from cross-file state pollution. Seen again 2026-09-17: `media-visuals.test.ts` timing tests failed under the full run but pass 30/30 alone. | The polluting state is found and isolated. Two consecutive full `npx jest` runs on Windows give identical results. | merged #382; verified again on current main `05bce71` with two identical full runs (334 suites, 4,523 passed, 29 skipped) |
| G-4 | Required `e2e-all` waits on queued macOS/Windows shards, often for hours, which makes every PR slow to land. | The queue time is measured, and a proposal (fewer shards, a smaller required set, or caching) goes to Aden **before** any required context changes. | needs Aden |

## MS — Media Studio: edit anything, export exactly that

Audit finding (2026-09-17): Storyboard is the most complete path. Shot prompt, narration, duration, order, framing, lens and camera move are all editable, and they save. The Timeline inspector and the Stage workspace, however, present many controls that **never reach the export**:

- **Timeline:** clip framing and transition picker only highlight a button. Colour grade is a CSS filter on the preview. Music ducking is display text. Speed, voice gain and track mute affect preview playback only.
- **Stage:** camera, motion, lighting and parallax drive a React preview. The FFmpeg export does no compositing (see the CLAIMS integration note of 2026-09-13).

A control that doesn't change the video is a bug for this goal.

| ID | Item | Done when | Serves | Status |
|---|---|---|---|---|
| MS-1 | **Camera moves reach the video.** New projects saved `fit`, which skips Ken Burns motion. Measured: frame difference was 0 before, 14.4 (push-in) and 39.5 (pan) with crop. Aden chose crop as the default. | Merged, and a default new project exports visible motion. | Task 6 | merged #352 |
| MS-2 | **Transitions between shots:** a per-shot "into next shot" choice of cut, crossfade or fade through black. FFmpeg `xfade`/`acrossfade`. Each transition shortens the total by its length, so narration timing and captions must be re-based. | A 3-shot render with a crossfade has the expected total duration, blended frames at the boundary (measured), and captions still aligned. | Task 6 | merged #375 |
| MS-3 | **Caption style:** size, position (bottom, middle, top), font, colour and outline, saved per project, for both Storyboard and "Make the video". Build on `media-render.ts` `defaultSubtitleStyle` / `force_style`. Respect title-safe insets (skill `generated-graphics-legibility`). | Changing each setting changes the burned captions in a real render (sampled frame inspected), in 16:9 and 9:16. | Task 6 | merged #358 |
| MS-4 | **Background music for Storyboard,** with a volume slider and automatic ducking under narration. Reuse `media-music.ts` from the job pipeline; ducking via `sidechaincompress`. | A render with music has a measurably quieter music bed while narration plays (`volumedetect` on sampled windows), and no clipping. | Task 6 | open |
| MS-5 | **Title and text cards:** an optional per-shot text overlay (heading plus sub-line) with position and duration. Measure before drawing, so long text wraps and never clips. | Rendered frames show the text inside safe areas at 16:9 and 9:16, and long text wraps. | Task 6 | merged #374 |
| MS-6 | **Timeline inspector made real or removed:** transitions, colour grade, speed, voice gain, mute. Each control either applies to a re-render of the selected job (via `media-video.ts`) or is removed. No preview-only control stays unlabelled. | For each control: an export changes accordingly (measured), or the control is gone and a test asserts it is absent. | Task 6 | merged #379; #347 was closed without merging and is not a dependency |
| MS-7 | **Stage workspace honesty:** label the camera, lighting and parallax presets "preview only" now, or remove them. Real compositing into the MP4 is a separate, larger item (MS-12). | No Stage control implies an export effect it doesn't have. | Task 6 | merged #359 |
| MS-8 | **Smooth camera motion:** FFmpeg `zoompan` on a same-size image steps in whole pixels, which visibly jitters on slow push-ins. Standard fix: upscale the source before `zoompan` (or use a sub-pixel crop/scale expression). | A/B on the same shot: frame-to-frame motion is monotonic without judder (measured motion vectors or pixel shift per frame), render-time cost recorded. | quality | merged #376 for Storyboard; job-pipeline path remains unverified |
| MS-9 | **Use this PC's GPU to encode:** detect `h264_nvenc` (RTX 2050) and use it for Storyboard and job renders, falling back to `libx264` if the NVENC probe fails. | Same project rendered both ways: time recorded, output passes `media-qa` inspection, fallback proven by forcing a probe failure. | speed | open |
| MS-10 | **Undo/redo and autosave in Storyboard,** so editing everything is safe. | Edit → undo → redo round-trips shot fields, and reopening the app keeps unsaved edits or asks. | UX | merged #373 |
| MS-11 | **Gemini frames live check:** #351 merged 2026-09-17 (paid, confirmed option), but no real Google request has been made yet. | One frame generated with Aden's key on his PC; the result or Google's error recorded. | Task 2 | needs Aden |
| MS-12 | **Stage compositing into the MP4:** character and plate layers, parallax and lighting rendered by FFmpeg `overlay`. Large; design first. | Design note approved by Aden, then a render whose sampled frames show the layered composite. | Task 5 | needs Aden |
| MS-13 | **Land the open Media Studio PRs** before starting overlapping work: #343 (doctor false pass), #346 (copy), #347 (render from cuts), #348 (Kokoro guidance), #350 (test timeout), #352 (MS-1). | Each merged, or closed with a reason. | all | complete: #343/#346/#348/#350/#352 merged; #347 closed unmerged and superseded by #379's timeline-control work |

## PROV — Image and video generation through every connected account

Aden, 2026-09-17: image and video generation should work through his Claude Pro and Codex (ChatGPT) subscriptions and **every connected API key whose provider has an image or video model**. The rules from `storyboard-frame-providers.ts` apply to every item:
- It is an explicit choice, never a silent fallback.
- It says before generating whether it is paid, uses plan limits, or may watermark.
- Paid use needs a first-use confirmation.
- Nothing is sent online while Online is off.
- A retired model is never offered (skill `retired-model-ids`).

What the vendors say (search on 2026-09-17; **re-read the vendor's own page before building each item**):

| Account | Image | Video | Source |
|---|---|---|---|
| Claude Pro / Anthropic key | **None.** Claude understands images but cannot generate them; it can draw diagrams/SVG through code. | None | [Can Claude produce images?](https://support.claude.com/en/articles/9002504-can-claude-produce-images) |
| ChatGPT plan through Codex CLI | Built-in image generation, billed against the ChatGPT plan's limits. It needs ChatGPT sign-in, not an API key. | Not found | [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan). Verify the official Codex docs; the details so far come from third-party wrappers. |
| OpenAI API key | GPT Image models (paid per image) | **Sora 2 API deprecated, shuts down 2026-09-24. Do not build.** | [Sora guide](https://developers.openai.com/api/docs/guides/video-generation), [pricing](https://developers.openai.com/api/docs/pricing) |
| Google AI Studio / Gemini key | `gemini-3.1-flash-image` (merged #351), `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`; no free tier | Veo 3.1 (`veo-3.1-generate-preview`, fast and lite previews), paid per second; Veo 2 shut down 2026-06-30 | [deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [video](https://ai.google.dev/gemini-api/docs/video), [pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Together AI, Hugging Face, OpenRouter | Some image models (unverified per account) | Unverified | Check each provider's model list with the connected key |
| Groq, DeepSeek, Cerebras, SambaNova, Moonshot | Believed text-only | — | Verify, then label "text only" |

| ID | Item | Done when | Status |
|---|---|---|---|
| PROV-1 | **One media-capability registry per connected account:** which image and video models each connected key or subscription can use, from the provider's live model list where one exists (Gemini `models.list`, OpenAI `/v1/models`), with cost class (free, plan limits, paid) and watermark. Used by the Storyboard frame picker, the shot-video picker and Settings. Accounts with no media models show "text only" instead of a broken option. | With a Google key saved, the picker offers only the Gemini models the key actually lists (asserted against a recorded `models.list`). Removing the key removes them. | open |
| PROV-2 | **ChatGPT plan images through Codex CLI:** a frame provider that runs the installed, signed-in `codex` CLI's image generation (the same subprocess route as HomeBot's ChatGPT-subscription chat provider). Label: "uses your ChatGPT plan limits, no per-image charge". Detect "not signed in" and "limit reached" plainly. Skill `stateful-fix-patterns` (subprocess providers). | A real frame is generated on this PC through Codex sign-in and saved to the shot; signed-out and limit-reached are each shown with a plain message. | merged #362; live signed-in frame still needs Aden |
| PROV-3 | **OpenAI API images:** a paid option on the current GPT Image model. Replace or remove any retired DALL·E path in `tools/web.ts` `image_generate`. | A recorded-request test gives the exact endpoint and body; a live frame is made with Aden's key; no retired model ID remains in any list. | open |
| PROV-4 | **Shots can be video clips (Veo 3.1 with the Google key):** generate a clip for a shot, optionally from its frame (image-to-video), paid per second with the cost shown before confirming. The Storyboard renderer must accept a video shot (trim to shot duration, keep narration timing). The router already models `video` providers. | A 3-shot render where one shot is a Veo clip has the correct total duration and moving content in that shot (measured); the cost is shown and confirmed before the request. | blocked by PROV-1 |
| PROV-5 | **Other connected keys with image models** (Together AI, Hugging Face Inference Providers, OpenRouter): add each only after its model list and price are read from the provider with the connected key. | One provider per PR, each with a recorded-request test and a live frame. | open |
| PROV-6 | **Claude subscription:** no image or video models. Optional: "Claude draws it" vector illustrations and title cards through SVG code, clearly labelled as drawings, not photos. | Aden decides whether this is wanted; if built, the SVG output is rasterised and inspected in a render. | needs Aden |

## IDE — Code mode on par with Cursor

**Today:** `workspace/WorkspaceShell.tsx` gives a VS Code-shaped layout: Explorer, tabbed editor, docked terminal, browser panel, and a read-only "Changes" diff of what HomeBot edited.
- **Editor:** `CodeEditor.tsx` is a textarea over highlight.js. The only shortcut is Ctrl+S; there's no find/replace, multi-cursor or folding. It was deliberately not Monaco, because of workers and CSP.
- **AI inside the IDE:** none. It only shows a strip of the assistant's tool activity.
- **Assistant-only tools:** `git_status`, `git_log`, `git_diff`, `git_branches` and `git_commit` exist, but there's no Git UI. Codebase tools are regex grep, file tree and file analysis, with no semantic index.

Cursor's headline capabilities are Agent, Plan Mode, Tab completion, inline edit, @-context, codebase understanding, rules, checkpoints, review/diffs, and MCP/plugins. **Verify each against [cursor.com/docs](https://cursor.com/docs) when you start its item; don't build from memory.**

| ID | Item | Done when | Status |
|---|---|---|---|
| IDE-1 | **A real editor.** Replace the textarea with **CodeMirror 6**: ES modules and no web workers, which removes the CSP/worker reason Monaco was rejected. Needs find/replace, multi-cursor, folding, bracket matching, and the VS Code keymap. Swap only `CodeEditor.tsx`, as its header intends. | Real Electron test: open a file, find/replace, multi-cursor edit, save, and the file on disk matches. The CSP is unchanged. | merged #360 |
| IDE-2 | **AI chat panel docked in the IDE,** with @file, @folder, @selection and @terminal context chips, using the same models and tools as main chat. | Asking about an @-mentioned file sends that file's content (assert the assembled request), and the answer appears in the panel. | merged #364 |
| IDE-3 | **Agent edits you can accept or reject:** multi-file changes shown as per-file and per-hunk diffs with Accept / Reject before they're written, extending `ChangesPanel`. | Rejecting a hunk leaves the file byte-identical; accepting writes exactly the shown hunk. | merged #378 |
| IDE-4 | **Checkpoints:** restore every file an agent run touched to its state before the run. It must be git-aware and never discard user edits made after the run without confirming. | Run → edit by user → restore: the agent's changes revert, the user's later edit is kept or confirmed. | blocked by IDE-3 |
| IDE-5 | **Inline edit (Ctrl+K)** on a selection: prompt → diff preview in place → accept/reject. | The selected range is replaced only on accept, and undo restores it. | merged #381 |
| IDE-6 | **Tab completion** from a local fill-in-the-middle model via Ollama (sized for 4 GB VRAM, e.g. a 1.5B coder model), with ghost text and Tab to accept. Latency budget measured on this PC. | p50 latency recorded. Accept inserts the suggestion; it's off when no local model is present, with setup guidance. | blocked by IDE-1 |
| IDE-7 | **Codebase understanding:** an embeddings index of the open folder, kept fresh on save, for @codebase and agent context. Local embedding model, nothing uploaded unless Online is on. | A question needing a file not mentioned retrieves it (assert the retrieved paths). The index updates after a save. | open |
| IDE-8 | **Project rules:** load `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*` and `.cursorrules` from the open folder into the IDE agent's context, shown in a Rules view. | A rule in the folder visibly changes the agent's assembled system prompt (asserted). | blocked by IDE-2 |
| IDE-9 | **Search across files** UI (Ctrl+Shift+F) with replace-in-files preview, on top of `search.ts` / `grep_code`. | Search finds matches in several files; replace preview then apply changes exactly those lines. | open |
| IDE-10 | **Source control panel:** status, stage/unstage, commit, branch switch, diff, using `git.ts`. | A real repo round trip: change → stage → commit → log shows it. | merged #361 |
| IDE-11 | **Problems and tasks:** run package scripts from the IDE; TypeScript/ESLint output parsed into a clickable Problems list. | A seeded type error appears in Problems and clicking opens the line. | open |
| IDE-12 | **Plan mode and review:** the agent writes a plan the user approves before edits; "review my changes" runs over the working diff. | Plan requires approval before any write (asserted); review comments reference real diff lines. | blocked by IDE-3 |
| IDE-13 | **MCP tools in the IDE agent,** reusing HomeBot's existing MCP connections. | An MCP tool call from the IDE agent executes and is shown in activity. | blocked by IDE-2 |

## REL — Ready for user testing

| ID | Item | Done when | Status |
|---|---|---|---|
| REL-1 | **Installer build and fresh-profile acceptance** (MEDIA_STUDIO_PLAN Task 8): install the actual artifact on a fresh Windows profile and run the agreed flows. Skills: `homebot-test-build`, `homebot-live-e2e`. | Recorded run: install → first-run → chat → voice → Storyboard video → "Make the video" → Code mode open/edit/save → automation. Each step pass/fail with evidence. | blocked by G-1, G-2 |
| REL-2 | **A user-testing checklist for Aden:** what to try, what each external setup needs (Online, keys, ComfyUI, Colab, FFmpeg download), and how to report a problem. | `docs/USER_TESTING_CHECKLIST.md` merged, and every step in it was performed once by an agent on a fresh profile. | blocked by REL-1 |
| REL-3 | **No dead controls anywhere a tester will click:** a reachability sweep (skill `reachability-audit`) across all modes, not just Media Studio. | A sweep report listing each control and its effect; every dead one fixed or removed under its own ID. | swept |
| REL-3.1 | **Dead IPC channels:** `setAlwaysOnTop` and `licenseValidate` | Removed or wired to UI | merged #388 |
| REL-3.2 | **Dead Document Tools:** `storeDocument`, `getDocument`, `clearDocuments` | Removed unless Document Manager is planned | merged #393; #389 did not remove the production exports |
| REL-3.3 | **Dead Hardware checks:** VRAM/Model recommendations | Removed | merged #391 |
| REL-3.4 | **Dead Colab Queue features:** `cancelColabJob`, `retryColabJob` | Wired to Media Studio UI or removed | open |
| REL-3.5 | **Unassigned dead-export tail:** `getOllamaTools`, `validateLicense`, `sameTextCard`, plus the REL-3.2 document exports | Each candidate rechecked on current main; zero-caller exports removed without deleting live or test-only guards | merged #393 |
| REL-3.6 | **Mounted but unused i18n scaffolding:** dictionaries and `I18nProvider` exist, but no caller reads translations and no locale picker writes the setting | Aden chooses whether multilingual UI is in scope; then wire a visible locale flow or remove the unused mount and dictionaries | needs Aden |
| REL-4 | **Crash and error reporting a tester can send:** a local log bundle via "Report a problem", with no secrets or keys included. | The bundle is created, contains recent logs, and a seeded API key does not appear in it (asserted). | merged #363 |

## Needs Aden

- **G-4:** any change to required CI contexts.
- **MS-11:** one paid Gemini image with your key (about US$0.07); billing must be enabled on the key's Google project.
- **MS-12:** approve a design before Stage compositing is built.
- **IDE-6 / IDE-7:** OK to download local models (a coder model for Tab, an embedding model) when Online is on.
- **REL-1:** a Windows profile or machine that has never run HomeBot, for acceptance.
- **PROV-2:** Codex CLI signed in with your ChatGPT account on this PC, for the live check.
- **PROV-3 / PROV-4:** one paid live request each with your OpenAI and Google keys (images cost cents; Veo is charged per second of video).
- **PROV-6:** whether you want Claude-drawn vector illustrations at all.
- **REL-3.6:** whether multilingual UI is in scope; keep and wire the i18n system, or remove the unused scaffolding.

## Research notes (2026-09-17)

- **Motion jitter:** `zoompan` computes crop offsets in whole pixels at output resolution, so slow zooms step visibly. Upscaling the input first (commonly 4×) makes each step sub-pixel after downscale, at a CPU cost. Measure it on this machine before adopting (MS-8).
- **Transitions:** `xfade` needs both inputs as streams with an offset. The output is shorter by the sum of transition durations, so shot timing, narration and SRT cues must be computed from the post-transition timeline (MS-2).
- **Music ducking:** `sidechaincompress` with narration as the key signal is the standard FFmpeg approach. Verify with measured loudness windows, not by listening to the code (MS-4).
- **Encoding:** the managed FFmpeg exposes `h264_nvenc` for the RTX 2050. NVENC is typically much faster than `libx264 -preset veryfast` at slightly lower quality per bit; measure both (MS-9).
- **Local images on 4 GB:** SD 1.5 is capped at 512 px (below a 16:9 frame). Quantised larger models via sd.cpp (#296) may fit, but that's unmeasured. The free online option may watermark, and Gemini costs about $0.067 per image. Colab is the heavy path.
- **Narration:** Edge TTS stays the default by measured evaluation (skill `tts-engine-evaluation`). Kokoro is the offline option and needs a one-time download (#348).
- **Editor:** CodeMirror 6 is modular and runs without web workers, fitting the app's CSP. Monaco needs worker configuration, which is why it was skipped (`CodeEditor.tsx` header).
