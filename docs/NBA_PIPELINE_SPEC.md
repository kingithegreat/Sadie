# NBA Voiceover Pipeline — Spec

Turn a raw NBA game clip into a finished narrated video: Gemini watches the
footage and writes the script, XTTS v2 speaks it in a cloned voice, ffmpeg
muxes the result back over the original video.

**Status:** pipeline definition + executable components. The external
services (Google Drive, Gemini API, Google Colab) belong to Aden — every
credential is read from environment variables or n8n credentials store.
Nothing in this pipeline enters a key, creates an account, or rotates a
token.

## Flow

```
Drive /NBA_Raw/game.mp4
        │  (n8n Drive trigger: file created)
        ▼
n8n HTTP node ──► scripts/analyze_clip.py ──► Gemini File API
        │                                       │ watches the clip
        │                                       ▼
        │                              { duration_sec, script, timestamps }
        ▼
n8n HTTP node ──► Colab worker (notebooks/xtts_voice_clone.ipynb)
        │          • reads script.txt from Drive
        │          • XTTS v2 inference against voice_sample.wav
        │          • writes /MyDrive/NBA_Voiceovers/output.wav
        ▼
n8n Move node ──► HomeBot media staging (wav + mp4 side by side)
        ▼
scripts/mux_media.py  (ffmpeg: copy video stream, encode audio to AAC)
        ▼
final_video.mp4
```

## Components

| File | Runs where | Job |
|---|---|---|
| `notebooks/xtts_voice_clone.ipynb` | Google Colab | Mount Drive, install coqui-tts, clone the voice from `voice_sample.wav`, speak `script.txt`, export `output.wav` |
| `scripts/analyze_clip.py` | anywhere with `GEMINI_API_KEY` | Upload clip to Gemini File API, get back `{duration_sec, script, timestamps}` JSON |
| `scripts/mux_media.py` | local (ffmpeg required) | Mux narration onto the original clip — video stream copied, never re-encoded |
| `workflows/nba_media_orchestrator.json` | n8n | Orchestrates all of the above |

## Contracts

### analyze_clip.py output (JSON)

```json
{
  "duration_sec": 42,
  "script": "Embiid backs down… and banks it home!",
  "timestamps": [
    { "start": 0.0, "end": 12.5, "text": "…" },
    { "start": 12.5, "end": 30.0, "text": "…" }
  ]
}
```

- `script` is the full narration text (what XTTS reads).
- `timestamps` segments the script against the action; consumers may use it
  for pacing, but the current mux treats the audio as one track.

### Colab worker I/O

- **In:** `/content/drive/MyDrive/NBA_Voiceovers/script.txt`,
  `/content/drive/MyDrive/voice_sample.wav`
- **Out:** `/content/drive/MyDrive/NBA_Voiceovers/output.wav`

The notebook polls for `script.txt`, so n8n can drop the file and signal via
Colab's own run mechanism; no interactive clicks required after first setup.

### mux_media.py

```
python scripts/mux_media.py <video> <audio> [-o out.mp4]
```

Runs exactly:

```
ffmpeg -i raw_video.mp4 -i output.wav -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 final_video.mp4
```

Video is stream-copied (no quality loss, fast); audio is encoded AAC because
raw WAV does not belong in an MP4 container.

## Environment

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | analyze_clip.py | Gemini API access |
| `NBA_RAW_DIR` / `NBA_STAGING_DIR` | n8n workflow paths | Drive folders; defaults per spec |

## What this deliberately is NOT

- No new widget UI. This pipeline runs headless; wiring it into Media Studio
  is a separate decision.
- No bundled TTS model. XTTS runs on Colab, not on the user's machine —
  consistent with the Voicebox/Kokoro decision (detect-and-use remote, never
  bundle).
- No credential handling. Keys live in Aden's env / n8n credential store.
