---
name: feature-decision-closure
description: Close out a "should we build X" question so no future session re-litigates it — record the decision, the evidence that settled it, and the next lever if the underlying complaint resurfaces. Use when Aden says "drop it", "not worth it", "decided", or when a measurement settles a build-vs-skip question; and when you notice the same evaluation being repeated across sessions. Covers the closure record format and the HomeBot decisions already closed.
---

# Close a decision so it stays closed

Multi-agent repos re-litigate closed questions unless the closure is written where the next
session will find it. A decision that lives only in chat history WILL be re-evaluated from
scratch, costing a full measurement cycle again.

## The closure record (three parts)

1. **The ruling** — one line, in decision language: "Kokoro dropped. Edge TTS stays."
2. **The evidence that settled it** — the measured facts, with the one finding that was
   decisive. Not the whole investigation; the load-bearing fact.
3. **The reopen condition / next lever** — what would have to change to revisit, or where the
   real fix lives if the underlying complaint resurfaces.

## Closed decisions in HomeBot (as of 2026-08-23) — do not re-open without new evidence

| Decision | Decisive fact | Next lever if complaint resurfaces |
|---|---|---|
| **Remotion: NO** | Licence forbids shipping a derivative; HomeBot is a sold product whose headline feature is video | None — structural, not technical |
| **Kokoro/Voicebox narration: NO** | 24 kHz is Kokoro's own model-native ceiling (`RawAudio(i.data, 24e3)` hardcoded) — identical to Edge TTS's rate; levels within loudnorm reach; Edge tighter pacing | Other Edge voices (`en-US-EmmaNeural` etc.) are a one-line change if voice CHARACTER is the complaint |
| **ElevenLabs cloud TTS: NO** ("not worth it") | Free tier ≈10 min/mo non-commercial; shipping needs $22/mo Creator | Revisit only if a paid-tier budget is approved for narration |
| **Agent Reach wrapper: NO** | It has no fetch/read/search commands at all — nothing to wrap | None until upstream adds those commands |

## Where closures live

- **Session memory** (`/memories/session/plan.md`) — this session's view.
- **Repo skill** (`.claude/skills/tts-engine-evaluation/SKILL.md`) — the method AND the Kokoro
  outcome as a worked example, so any future engine question starts from the conclusion.
- **CLAIMS.md / vault Plan.md** — cross-session coordination channels.

Rule of thumb: if closing it took a measurement, the closure belongs in a repo skill (agents
load skills; they don't load your chat log). If it was a pure business call, CLAIMS.md or the
vault suffices.

## Anti-pattern: the zombie evaluation

Symptom: the same engine/library/approach gets benchmarked every few weeks by different
sessions, each concluding "not better". Cause: the previous conclusion was recorded in chat,
not in a loaded artifact. Fix: write the closure into a skill BEFORE ending the session, while
the decisive numbers are still at hand.
