---
name: tts-engine-evaluation
description: Settle a "should we switch TTS engines / is X better than Edge TTS" question by measuring produced audio files, not by reading library docs or trusting marketing sample rates. Use when asked to evaluate Kokoro, Voicebox, ElevenLabs, Piper, or any narration engine for HomeBot's Media Studio; when someone reports "the voice isn't high enough quality"; and before wiring any new TTS provider. Covers the ffprobe/volumedetect method, the model-native-rate trap (a wrapper cannot exceed its model), and the decision rule that kept Edge TTS.
---

# Evaluate a TTS engine by measuring its output, not its spec sheet

The tempting evaluation reads the library's README, sees "48 kHz!" or "neural!", and concludes
quality. Every claim about audio quality must be settled by generating the SAME script through
both engines and measuring the produced files. A wrapper's advertised rate can differ from what
it actually emits, and a model's native rate caps every wrapper built on it.

## The method (worked end-to-end 2026-08-23: Kokoro vs Edge TTS)

1. **One script, both engines.** ~55 words of real narration-style prose — not "hello world",
   which has no sentence pauses and hides pacing differences.

2. **Generate through each engine in its PRODUCTION configuration.** For Edge TTS that meant
   `AUDIO_24KHZ_96KBITRATE_MONO_MP3` exactly as `voice.ts` sets it — evaluating a config the
   app doesn't ship proves nothing about the app.

3. **Measure with ffprobe** (format facts):
   ```bash
   ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bit_rate \
     -show_entries format=duration -of default=noprint_wrappers=1 file.ext
   ```

4. **Measure levels with volumedetect**:
   ```bash
   ffmpeg -hide_banner -i file.ext -af volumedetect -f null NUL 2>&1 |
     grep -E "mean_volume|max_volume"
   ```
   Expect differences under ~2 dB to be irrelevant: Media Studio's loudnorm is the pipeline's
   loudness authority, so pre-normalisation level differences are erased downstream.

5. **Measure pacing with silencedetect** (`noise=-40dB:d=0.5`): count and length of sentence
   gaps. Fewer/shorter gaps = tighter narration for the same words.

6. **Time warm generations**, at least two runs each. Note WHAT the time is made of: network
   TTS time is latency (varies with connectivity), local model time is compute (deterministic).

## The model-native-rate trap

This is the finding that ended the Kokoro track. Aden's framing was "Edge caps at 24 kHz —
that's the library ceiling", implying a different engine could beat it. Verified false:

- `kokoro-js/dist/kokoro.cjs` constructs output as `new RawAudio(i.data, 24e3)` — hardcoded.
- The Kokoro-82M ONNX model itself is a 24 kHz vocoder. **No packaging of a model — JS lib,
  Tauri+Python app, raw Python — can exceed the model's native rate.**

So before evaluating any engine, find its MODEL's native rate:
- Grep the wrapper's dist/source for the `RawAudio(` (or equivalent) construction.
- Or generate one sample and ffprobe it — the emitted rate IS the native rate.
- A wrapper advertising more than its model delivers is lying; trust the file.

Resampling up (`ffmpeg -ar 48000`) works trivially but adds no information — upsampling cannot
create detail the source never produced. Never present an upsampled rate as a quality gain.

## The decision rule

An engine swap must win on an axis that survives the pipeline:

| Axis | Survives? | Why |
|---|---|---|
| Sample rate/channels | Only if HIGHER | Same-rate = no pipeline change needed; higher = real fidelity gain |
| Loudness | Almost never | loudnorm normalises it away |
| Pacing/silence | Yes | Affects ducking mix and video length |
| Voice character | Yes — but only human ears settle it | Numbers cannot judge this; produce A/B samples and let Aden listen |
| Speed/offline | Yes | Real operational value, but doesn't make better-sounding video |

**Kokoro vs Edge outcome (2026-08-23): same 24 kHz mono, levels within 2 dB, Edge tighter
pacing, Kokoro ~2× faster + offline. Dropped — no axis that survives the pipeline favoured it,
and voice character was never raised as a complaint about Ava specifically.**

## Cost check before any cloud TTS

ElevenLabs was evaluated and ruled out the same day: free tier ≈ 10 min/month non-commercial;
shipping in a sold product needs Creator ($22/mo). Apply the same test to any cloud voice:
free tier must cover evaluation AND the shipping tier must fit the product's economics.

## Bench location

`narration-measure/` in the repo working tree (untracked): `kokoro.mjs`, `generate.js`
(Edge path), paired samples `kokoro-heart.wav` / `edge-ava.mp3`. Reusable as-is for any future
engine comparison — add a third generator script, keep the measurement commands identical so
numbers stay comparable across evaluations.
