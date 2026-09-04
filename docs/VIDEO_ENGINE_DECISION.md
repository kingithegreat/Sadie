# Video Engine Decision — JSON API first, Remotion deferred

**Decision date:** 2026-09-04
**Status:** Decided (Aden picked the recommendation via the session question)
**Decided by:** Aden + Claude session on claude/model-picker-sections
**Supersedes:** nothing; this is the first written decision on the question
**Revisit trigger:** the day HomeBot needs pixel-level custom 2D animation that a
template API cannot express (e.g. Ancient Pathways-style puppet rigs inside the app)

## The decision

HomeBot's video-generation engine is an **n8n-friendly JSON API** (Creatomate or
JSON2Video) with **Whisper timestamping for captions**. Code-first Remotion is
explicitly deferred, not rejected.

## Why

| Criterion | JSON API (chosen) | Code-first Remotion (deferred) |
|---|---|---|
| n8n integration | Native HTTP Request / webhook node — zero custom infra | Needs a webhook wrapper plus self-hosted render infra |
| Maintenance | API handles rendering, encoding, storage | We own Lambda renderers + S3 orchestration |
| Licensing | Pay-per-rendered-minute, no seat-count trigger | Company license required at 3+ employees |
| Flexibility | Template JSON schema (covers social/short-form) | Full React/Canvas/Three.js control |
| Cost shape | Scales with usage — zero cost at zero usage | License + AWS fixed costs from day one |

The deciding factors:

1. **The n8n track is HomeBot's automation spine** (`docs/n8n-integration.md`).
   A JSON API lands in that story with one HTTP node; Remotion would add a
   rendering stack to operate before a single video exists.
2. **Non-technical users are the audience.** Template JSON with preset
   compositions matches how the rest of HomeBot hides machinery. Remotion's
   power is pixel control — for a person who says "make me a video about my
   listing", that power is invisible cost.
3. **The licensing cliff is real.** `docs/SELLING_AND_LICENSING.md` shows HomeBot
   itself is a licensed product; adding a third-party dependency that changes
   price class at 3+ employees is a liability bought before any revenue.

## What this means in practice

- **Rung now:** a `video_render` tool that POSTs a JSON template spec to the
  API and polls/handles the webhook; captions via Whisper word timestamps
  (16kHz WAV → whisper.cpp JSON → template caption elements).
- **Media Studio stays the surface** — `widget/src/main/media-studio.ts` already
  anticipates a render phase; the JSON spec builds from the same scene model.
- **Ancient Pathways (puppet animation) stays on its current Colab/ffmpeg
  pipeline.** If it ever moves in-app and needs pixel-level puppet control,
  that is the revisit trigger above — not before.
- ** CLAIMS.md row required before any scaffold** (standard protocol).

## What we are NOT deciding

- Which vendor (Creatomate vs JSON2Video) — that is a pricing/quality bake-off
  at build time, not now.
- Whether Remotion is ever used. It is deferred, with a written trigger, not
  banned.
