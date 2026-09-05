# The machine these plans actually run on

Measured 2026-09-05. Two planning documents have now been written against an
Apple Silicon Mac — the Drive improvement plan ("consumer hardware, e.g. M3
Mac") and the Antigravity Execution Plan V1 (Metal/MPS, MLX, `f5-tts-mlx`,
"macOS swap thrashing"). Neither platform exists here, and
`electron-builder.yml` has a `win:`-only NSIS target.

This file is the ground truth. Check it before writing another phase.

## What is here

| | |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| CPU | Intel i5-12450H — 8 cores / 12 threads |
| RAM | **15.7 GB total** (2 GB free at time of measurement) |
| GPU | **NVIDIA RTX 2050, 4096 MiB VRAM** (driver 581.08) |
| iGPU | Intel UHD Graphics, 2 GB shared |
| WSL2 | Ubuntu (stopped) + docker-desktop (running), both v2 |
| Installed | ollama, docker, wsl, python, nvidia-smi |
| Not on PATH | **ffmpeg** — see below; the pipeline does not need it there |

Ollama already holds: `qwen2.5:7b` (4.7 GB), `qwen2.5-coder:7b` (4.7 GB),
`dolphin-mistral:7b` (4.1 GB), `moondream` (1.7 GB), `qwen2.5:0.5b` (397 MB).

**ffmpeg is absent from PATH and that is fine.** `pipeline/config.py:138` sets
`FFMPEG_BIN = get_ffmpeg_exe()`, which resolves to the binary imageio-ffmpeg
vendors — `ffmpeg-win-x86_64-v7.1.exe` under site-packages — and every call site
uses `FFMPEG_BIN` rather than the bare name. Do not add an "install ffmpeg" step
to a plan; do not assume a shell `ffmpeg` works either.

## The binding constraint is 4 GB of VRAM

Everything below follows from that one number.

**A 7B model at Q4 is 4.1–4.7 GB and does not fit in 4096 MiB** alongside a
context window. Ollama already handles this by offloading layers to CPU — it
works, it is just slower than the plans assume. Nothing needs fixing here; it
needs to be *planned around* rather than planned over.

**SDXL is not viable on this GPU.** It wants 8–12 GB. At 4 GB you are into
aggressive offloading and tiled VAE, which turns an "~8 second" generation into
minutes — the exact failure the Mac review warned about, arriving by a different
road. SD1.5-class models at 512² fit and are usable; SDXL does not.

**The concurrency the plan describes cannot happen.** It budgets Ollama
(6–10 GB) + embeddings (2 GB) + ComfyUI/SDXL (8–12 GB) + TTS (4 GB) +
rendering, calling it "25–35 GB simultaneously". This machine has **15.7 GB
total system RAM and 4 GB of VRAM**. That is not a memory-pressure problem to be
solved with a lifecycle manager; it is roughly double the hardware.

## Corrections, per phase

**Phase 5 — images.** Do *not* switch ComfyUI to "a native macOS host service
with Metal/MPS"; there is no Metal here. Do not containerise SDXL either — the
VRAM is the limit, not the container. Keep image generation **remote**: the
project already uses Gemini, Grok and Pollinations, and today's testing showed
free text-to-image cannot hold a locked character anyway, so local SDXL would
buy nothing this project needs.

**Phase 6 — audio.** `f5-tts-mlx` is Apple MLX and will not run. Edge TTS is
already in use, is free, needs no VRAM, and produced every shipped episode.
Keep it. The one item worth taking from the review is the **48 kHz standard** —
correct, and already the case: all nine episode masters probe at 48000 Hz
stereo. Do not lock to 24 kHz. (One exception found while checking: the Season 1
trailer is 96 kHz — the only deliverable off the standard, and filed on the
Ancient Pathways board.)

**Phase 1 — Docker GPU passthrough is not a blocker here.** Docker Desktop on
the WSL2 backend does NVIDIA passthrough on Windows. The "critical blocker" is a
macOS limitation. It still isn't worth doing for SDXL, for the VRAM reason
above, but the stated reason is wrong.

**Phase 7 — the proposed lifecycle manager is the right idea for the wrong
reason.** With 4 GB of VRAM you are not orchestrating five resident models; you
are running **one at a time, and mostly one at all**. `keep_alive` tuning on
Ollama is worth it. A general orchestrator for weights that cannot co-reside is
not.

## What this machine is genuinely good at

- **Ollama 7B-class local inference**, with CPU offload — already working
- **`moondream` (1.7 GB) for vision** — this one comfortably fits in VRAM
- **`qwen2.5:0.5b` for fast structured tasks** — routing, classification, tags
- **ffmpeg video work on CPU** — 8 cores, and it is how every episode ships
- **Docker for headless services** — n8n, MCP servers, RAGFlow. All correct, all
  unaffected by VRAM

## The rule to carry forward

Before any phase that names a model, a container or a GPU, state the VRAM and
RAM it needs and compare them to the two numbers at the top of this file. Both
plans so far skipped that step, and both reached conclusions about a machine
nobody has.
