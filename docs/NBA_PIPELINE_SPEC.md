# NBA Voiceover Pipeline — Spec

Turn a raw NBA game clip into a finished narrated video: Gemini watches the
footage and writes the script, XTTS v2 speaks it in a cloned voice, ffmpeg
muxes the result back over the original video.

**Status:** runnable end-to-end on one machine, given the one-time setup in
"What has to run for this to work". The external services (Google Drive,
Gemini API, Google Colab) belong to Aden — every credential is read from
environment variables or n8n credentials store. Nothing in this pipeline
enters a key, creates an account, or rotates a token.

## Flow

```
Drive /NBA_Raw/game.mp4
        │  (n8n Drive trigger: file created)
        ▼
n8n Drive node ──► download clip to NBA_STAGING_DIR on the n8n host
        ▼
n8n HTTP node ──► scripts/analyzer_server.py  (127.0.0.1:8000)
        │              └─ scripts/analyze_clip.py ──► Gemini File API watches the clip
        ▼                              { duration_sec, script, timestamps }
n8n Drive node ──► upload narration as /MyDrive/NBA_Voiceovers/script.txt
        │
        │   (Colab watch-mode notebook polls for exactly that file —
        │    no bridge into Colab exists or is needed)
        ▼
notebooks/xtts_voice_clone.ipynb ──► XTTS v2 against voice_sample.wav
        │                            writes /MyDrive/NBA_Voiceovers/output.wav
        ▼
n8n Drive node ──► download output.wav  (retries every 60 s while it renders)
        ▼
scripts/mux_media.py  (ffmpeg: copy video stream, encode audio to AAC)
        ▼
NBA_STAGING_DIR/<stem>_final.mp4
```

## Components

| File | Runs where | Job |
|---|---|---|
| `notebooks/xtts_voice_clone.ipynb` | Google Colab | Mount Drive, install coqui-tts, clone the voice from `voice_sample.wav`, speak `script.txt`, export `output.wav` |
| `scripts/analyzer_server.py` | local (same box as n8n) | One-endpoint HTTP wrapper around `analyze()` — stdlib only, no web framework |
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

The handoff is Drive-only, by design. The notebook's watch-mode cell polls for
`script.txt`, renders it, then renames the script aside (`.done-<timestamp>`)
so a completed run is distinguishable from a fresh one. n8n drops the file and
waits for the WAV — there is no HTTP bridge into Colab. A previous revision of
this workflow pointed at `colab.research.google.com/api/workers/...`, which is
not a real endpoint; do not reintroduce it.

### analyzer_server.py

```
python scripts/analyzer_server.py          # listens on 127.0.0.1:8000
NBA_ANALYZER_PORT=9000 python scripts/analyzer_server.py
```

- `POST /analyze` with `{"videoPath": "<absolute path>"}` → the JSON below.
- `GET /health` → `{"ok": true}` — use this to check the server is up before
  trusting the pipeline.
- Errors are structured: 400 bad request, 404 missing file, 500 Gemini/SDK
  failure — so the workflow fails with a readable reason instead of hanging.

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
| `GEMINI_API_KEY` | analyze_clip.py (via analyzer server) | Gemini API access |
| `NBA_STAGING_DIR` | n8n workflow | Local staging directory for raw clip, output.wav and the final MP4 |
| `NBA_REPO_DIR` | n8n workflow (mux node) | Absolute path to this repository, so the mux command can find `scripts/mux_media.py` |
| `NBA_ANALYZER_PORT` | analyzer_server.py + n8n HTTP node | Optional; defaults to 8000 |

## What has to run for this to work

One-time, all Aden's — this pipeline never provisions accounts or keys:

1. **Drive folders** exist: `NBA_Raw`, `NBA_Voiceovers`; `voice_sample.wav`
   (10–30 s of clean target-voice audio) sits in `MyDrive`.
2. **Colab watch mode**: open the notebook on a T4 runtime and start cell 7
   (watch mode). It stays running and renders every script.txt that appears.
3. **Analyzer server** running on the n8n machine:
   `GEMINI_API_KEY=... python scripts/analyzer_server.py`.
4. **n8n environment**: set `NBA_STAGING_DIR`, `NBA_REPO_DIR` in the n8n
   process, then import `workflows/nba_media_orchestrator.json`. Node schemas
   drift between n8n versions — if any node shows a schema warning on import,
   re-pick the value in the editor once. Activate the workflow when green.
5. **python + ffmpeg** on the PATH of the n8n process.

Then: drop an MP4 into `NBA_Raw`. The finished `<stem>_final.mp4` lands in
the staging directory.

## What this deliberately is NOT

- No new widget UI. This pipeline runs headless; wiring it into Media Studio
  is a separate decision.
- No bundled TTS model. XTTS runs on Colab, not on the user's machine —
  consistent with the Voicebox/Kokoro decision (detect-and-use remote, never
  bundle).
- No credential handling. Keys live in Aden's env / n8n credential store.
