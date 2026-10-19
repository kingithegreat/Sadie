---
name: qa-video-check
description: Check a rendered video honestly — automated flags plus actually looking — before anyone calls it done.
when_to_use: Any rendered proof, shot or episode before reporting it complete or asking Aden to accept.
---
# QA video check

Sources: Drive plan §3–5; Sadie USER_TESTING_PLAN MS-RIG-0; AP `CLAUDE.md` gates; CLAUDE.md rules 10/13.

1. Run gates: AP `python -m pytest -q -p no:warnings` and `python scripts/doctor.py --episode <id>`; existing FFmpeg media-check helper for black/silence/loudness flags (Aden's PC: `C:/Users/adenk/.homebot/resource-plan-tools/`). Pauses/fades are review points, not failures.
2. Feed each check something it should flag first — a zero is not a pass until proven.
3. **Open the artifact and look.** Extract frames; for proofs inspect all frames (MS-RIG-0: 180 frames, 6 s, 1920×1080, 30 fps, captions off) plus normal-speed playback.
4. Look for: duplicate limbs, gaps at joints, clipping/overlap, mouth off-face or on a turned head, magenta fringe, text in art, identity drift between cuts, guest/host scale jumps.
5. Record: file path, SHA-256, resolution/fps/duration, frames inspected, findings, limits.
6. Only Aden records PASS/FAIL (Drive plan). Technical fixture success never closes art, speech, rig or episode quality.
