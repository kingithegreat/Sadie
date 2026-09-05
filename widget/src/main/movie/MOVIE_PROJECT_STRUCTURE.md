# Movie Project Folder Structure

```
movie/
├── project.json                    # Project metadata (name, createdAt, freeOnly, etc.)
├── characters/
│   ├── imhotep.json               # CharacterBibleEntry
│   └── ...                        # More characters
├── scenes/
│   ├── scene_01/
│   │   ├── scene.json             # Scene metadata (title, description, order)
│   │   ├── shot_001/
│   │   │   ├── prompt.json        # GenerationRequest (immutable input)
│   │   │   ├── status.json        # ShotJobState (mutable, survives crashes)
│   │   │   ├── character_refs/    # Symlinks or copies of visual refs
│   │   │   │   ├── imhotep_001.png
│   │   │   │   └── imhotep_002.png
│   │   │   ├── image/
│   │   │   │   └── shot_001.png   # Generated still
│   │   │   ├── video/
│   │   │   │   └── shot_001.mp4   # Animated output
│   │   │   └── qa.json            # QAResult (if status === QA or APPROVED)
│   │   ├── shot_002/
│   │   │   └── ...
│   │   └── ...
│   ├── scene_02/
│   └── ...
├── render/
│   ├── render.json                # RenderJobState
│   └── output.mp4                 # Final render
└── logs/
    └── router-decisions.jsonl     # One line per routing decision (audit trail)
```

## File Contracts

### `project.json`
```json
{
  "projectId": "imhotep-temple-01",
  "name": "Imhotep Approaches the Temple",
  "createdAt": "2026-09-05T...",
  "updatedAt": "2026-09-05T...",
  "freeOnly": true,
  "defaultResolution": [1024, 576],
  "defaultDurationSec": 8,
  "notes": "Golden hour cinematic sequence"
}
```

### `characters/{id}.json` — CharacterBibleEntry (from types.ts)
```json
{
  "id": "imhotep",
  "name": "Imhotep",
  "age": "40s",
  "face": "angular jaw, high cheekbones, olive skin, dark eyes",
  "hair": "shoulder-length black hair, slightly wavy, often tied back",
  "clothing": "white linen priestly robes with gold trim, leather sandals",
  "body": "lean, athletic build, 180cm",
  "voice": "deep, measured, slight Egyptian accent",
  "personality": "wise, calm, authoritative but kind",
  "visualReferences": ["characters/imhotep/ref_01.png", "characters/imhotep/ref_02.png"],
  "consistencyNotes": [
    "eyes are dark brown, never blue or green",
    "gold trim on robes is thin, not wide",
    "hair tie is simple leather cord"
  ],
  "revision": 1,
  "updatedAt": "2026-09-05T..."
}
```

### `scenes/{sceneId}/scene.json`
```json
{
  "sceneId": "scene_01",
  "title": "Approach at Golden Hour",
  "description": "Imhotep walks toward the temple entrance as the sun sets",
  "order": 1,
  "shots": ["shot_001", "shot_002", "shot_003", "shot_004", "shot_005", "shot_006", "shot_007", "shot_008", "shot_009", "shot_010"]
}
```

### `scenes/{sceneId}/shot_{N}/prompt.json` — GenerationRequest (from types.ts)
```json
{
  "kind": "image",
  "prompt": "Imhotep, ancient Egyptian priest, walking toward a massive sandstone temple entrance at golden hour. Warm directional light from low sun, long shadows. Cinematic wide shot, 24mm lens. Temple columns carved with hieroglyphs. Imhotep wears white linen robes with thin gold trim, hair tied back with leather cord.",
  "width": 1024,
  "height": 576,
  "characterRefs": ["movie/characters/imhotep/ref_01.png", "movie/characters/imhotep/ref_02.png"],
  "shotId": "shot_001",
  "shotDir": "movie/scenes/scene_01/shot_001",
  "freeOnly": true,
  "allowWatermark": false,
  "allowDeferred": false
}
```

### `scenes/{sceneId}/shot_{N}/status.json` — ShotJobState (from types.ts)
```json
{
  "shotId": "shot_001",
  "status": "IMAGE_GENERATED",
  "attempts": 1,
  "lastError": null,
  "characterRevisions": { "imhotep": 1 },
  "deferredTicket": null,
  "deferredProvider": null,
  "updatedAt": "2026-09-05T..."
}
```

### `scenes/{sceneId}/shot_{N}/qa.json` — QAResult (from types.ts)
```json
{
  "shotId": "shot_001",
  "passed": true,
  "checks": {
    "characterConsistency": { "passed": true, "score": 0.92, "notes": "Face matches ref within threshold" },
    "composition": { "passed": true, "score": 0.88, "notes": "Rule of thirds, good depth" },
    "lighting": { "passed": true, "score": 0.9, "notes": "Golden hour color temp correct" },
    "technical": { "passed": true, "score": 1.0, "notes": "No artifacts, correct resolution" }
  },
  "reviewedAt": "2026-09-05T...",
  "reviewedBy": "human"
}
```

### `logs/router-decisions.jsonl` (one JSON per line)
```json
{"timestamp":"2026-09-05T...","shotId":"shot_001","chosen":"pollinations","freeOnly":true,"summary":"pollinations (ready, $0.00, clean, i2v, 60/min)","rejected":[{"providerId":"imagen-3","reason":"costs $0.0001 and FREE ONLY is on"},{"providerId":"local-sd15","reason":"max 512x512 < requested 1024x576"}]}
```

## Resumability Rules

1. **Crash recovery**: `status.json` is written *before* generation starts (status=PROMPTED). On restart, any shot with status < IMAGE_GENERATED is retried.
2. **Bible drift detection**: `characterRevisions` in `status.json` tracks which bible revision each shot was generated against. If a character's `revision` > `status.characterRevisions[id]`, the shot is marked for regeneration.
3. **Colab deferral**: When `status=PROMPTED` and `deferredProvider` is set, the shot waits for a human to run the Colab cell and write results to `image/` or `video/`. A watcher (or manual `media_poll_deferred`) advances status to `IMAGE_GENERATED` / `VIDEO_GENERATED`.
4. **Contact sheet gate**: Before any video step, the first N stills are assembled into a contact sheet. If face drift > threshold, the slice stops at contact sheet — no video is generated.