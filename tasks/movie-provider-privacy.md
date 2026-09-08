# Movie and image provider Online consent

Local implementation verified on Windows, 2026-09-09. Branch:
`claude/studio-movie-privacy`, based on merged main `1e3b064` (M1 / PR #265).
Integration status is tracked in the
[work claim](https://app.notion.com/p/3d5829ebf7be8132852bd835bfbfa7ae).

## Behavior

Imagen, Pollinations and Colab previously accepted movie/image work without
checking the Online switch. ComfyUI and Stable Diffusion also accepted remote
configured URLs despite their local-provider names. Studio's Movie Router
returned success even when its saved report contained failed shots.

Provider entry points now read the existing Online choice at dispatch time,
using `resolveCloudLLM(settings).intended`. Missing or unreadable settings deny
online work. Explicit `useCustomLLM: false` overrides stale legacy consent.
Request arguments cannot grant consent; provider-specific keys remain separate.

The checks cover discovery, direct generation helpers, router fallback and each
ComfyUI submit/poll/download request. Colab is denied before writing a deferred
ticket that could be synchronized to its online worker. Revoking consent stops
subsequent remote requests; an already dispatched request is not cancelled.

Configured HTTP(S) generation endpoints use a shared guarded client. Only
loopback addresses bypass Online consent; private LAN destinations need consent.
`localhost` is pinned to `127.0.0.1`, HTTPS uses TLS, embedded URL credentials are
rejected, and Node's HTTP client does not follow redirects. Trusted local engines
still control their own network behavior; this is not an OS network sandbox.

The existing Studio error surface now shows a failed movie run as an error,
including partial failures. Privacy denials show actionable Online guidance;
the complete per-provider reasons remain in the report and project log.

## Reachable paths and evidence

- **Studio → Movie Router → Route & Generate** calls the existing preload IPC,
  trusted Studio gateway, real project runner, standard router and adapters.
  A fresh-profile Electron test clicks this path and checks the visible denial,
  saved `FAILED` shot, all six rejected providers, no image and no deferred ticket.
  Main-process fetch/http/https observers record zero provider requests; three
  positive controls prove the observers work.
- **Studio → Storyboard → Generate Frame**, the movie chat tool and existing
  direct image helpers reach the same guarded adapters. The tool/router test
  exercises the actual handler and persisted failed state with mocked transports.
- A controlled real HTTP loopback server exercises ComfyUI and Stable Diffusion
  discovery, submission and result handling while Online is off. Seven requests
  arrive; prompts and saved bytes match. The returned fixture bytes are not an
  AI image or evidence of live-provider quality.

The initial privacy regression failed 17 cases with two allowed controls before
the implementation, then passed all 19. Coverage now includes 37 privacy cases:
missing/stale consent, direct helpers, endpoint spoofing/LAN addresses, loopback
controls, HTTPS, invalid URLs, fallback and consent revocation between requests.
The IPC defect reproduced three failures with one successful/deferred control;
all four pass after the repair. Existing provider-ranking tests explicitly opt
into Online access where they expect cloud availability.

Committed verification paths:

- `widget/src/main/__tests__/movie-provider-privacy.test.ts`
- `widget/src/main/__tests__/movie-provider-local.test.ts`
- `widget/src/main/__tests__/movie-run-ipc.test.ts`
- `widget/src/renderer/e2e/movie-provider-privacy.e2e.spec.ts`
- Existing `studio-host.e2e.spec.ts` also verifies visible storyboard creation.

Local validation: 271 widget suites / 3,827 tests passed, 15 tests skipped,
using the existing CI `--forceExit` command. Root: 18 suites / 226 tests passed.
Both typechecks, lint (zero errors / eight existing warnings), Electron build,
docs drift and duplicate-export guard pass. Final IPC wording has a focused
recheck and rebuilt Electron verification. Required remote checks are still
pending at this local checkpoint.

This closes a bounded privacy prerequisite. Provider output/pricing accuracy,
speech (owned by a separate session), optional-module UI and real-video pilot
acceptance remain separate work. No live cloud credential, model download,
payment or publication was performed for this task.
