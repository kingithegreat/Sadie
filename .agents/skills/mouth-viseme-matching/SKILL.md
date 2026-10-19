---
name: mouth-viseme-matching
description: Which mouth tiles exist, how audio maps to them, and on which poses a mouth may be composited.
when_to_use: Any work on lip sync, mouth tiles, visemes or a "floating mouth" bug.
---
# Mouth / viseme matching

Sources: AP `pipeline/anim/characters.py` (POSE_ANGLE_CONFIG, viseme map), `pipeline/anim/lipsync.py`, `CLAUDE.md`, `docs/REMAINING_ART.md`.

- Tile set per character: 8 letters **A, E, I, O, U, M, B, L** at `workspace/branding/characters/<name>/mouth/<LETTER>.png`, drawn **front-view**, tight lower-face crop, mouth large and readable (not hidden by beard/moustache), no text.
- Lip sync derives 5 shapes from audio loudness and maps them to tiles: closed→M, mid→E, wide→I, round→O, open→A.
- **Owner decision 2026-09-02:** mouths are composited ONLY on front-facing poses (front, idle, pointing, waving, happy, laughing, thinking, listening…). three_quarter*, side, left, right and back poses get **no mouth**; they "talk" through body motion. Do not re-enable angled mouths without a per-angle tile set drawn for that angle.

## PROPOSED — per-orientation mouth sets (pending the AP owner, MS-RIG-0)
Not live. Nobody but the Ancient Pathways rig owner implements this. Source: HomeBot art audit 2026-10-20 (Aden's audit notes, "Mouth problem" and "Plan").
- Audit findings: one front-drawn `mouth` group per character; nothing records which orientation a pose faces or which expression a mouth belongs to; there are **no side or 3/4 mouth tiles anywhere**; Leila R1a has no mouth group and no mouth anchors yet; Flappy gets human-style lip compositing on 3/4 sprites because the beak branch is unreachable while he uses the sprite renderer; the rig profile has a `mouth` slot that would put a front mouth on `head_profile.png`; the "nothing lip-syncs" comment in characters.py is stale.
- Vocabulary: orientations `front, three_quarter_left, three_quarter_right, side_left, side_right` (+`back`, no mouth); visemes `closed, mid, wide, round, open`; mouth families `neutral` (neutral, thinking), `smile` (happy, excited, laughing), `down` (sad, angry), `surprised`. Expression heads drawn with the mouth area blank.
- Proposed path: `characters/<name>/mouths/<orientation>/<family>/<viseme>.png`.
- Proposed lookup: `mouths/<orientation>/<family>/<viseme>` → `mouths/<orientation>/neutral/<viseme>` → none (skip overlay, keep body-motion talking). **Never fall back across orientations**; unknown orientation fails closed.
- Kits: guests front + side x 3 families (neutral, smile, surprised) x 5 visemes; Leila 5 orientations x 4 families; Flappy beak sets for front/three_quarter/side.
- `_mouth_anchors` (252, hand-placed by Aden) are locked: never re-measure or overwrite. Per-character crop bands exist (e.g. Dhara, Leif) — a wrong band composites the nose/moustache.
- Known non-regression: `leif/turnaround/back` anchor rel_y 0.38 pending Aden's slider pass.
- Verify by rendering a short clip and looking at frames where the mouth changes (skill qa-video-check).
