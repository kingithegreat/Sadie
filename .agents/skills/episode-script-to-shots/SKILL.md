---
name: episode-script-to-shots
description: Turn an Ancient Pathways episode script into shots and image tickets using the existing pipeline, not a new one.
when_to_use: Planning or producing an episode's shots, storyboard or R1a tickets.
---
# Episode script to shots

Sources: AP `CLAUDE.md`, `run_pipeline.py`, `docs/CHARACTER_DESIGN_BIBLE.md` §4; Sadie colab notebook ticket fields; Drive plan §2 and §4.

1. Check Drive: full-episode work follows the accepted Leila proof; Flappy/two-character after Leila acceptance.
2. In AP run `python scripts/state_of_play.py` first. Check `workspace/render.lock` — one render at a time; never edit pipeline code mid-render.
3. Use the staged pipeline: `python run_pipeline.py --episode <id> --stage <stage>` (stages cache and resume). Don't replace `produce_cartoon_episode`; stages wrap it.
4. Directional continuity: Act I travel left→right/forward; Act II 3/4 perspective → Socratic two-shots; Act III sprint → low-angle wonder → golden-hour outro.
5. Shots needing new stills become R1a tickets with: `shotId, prompt, negativePrompt, width (1024), height (576), stagedCharacterRefs, seed, relativeOutputPath`; magenta ground for character cells; no text in prompts' output.
6. Talking shots: prefer front-facing poses (mouths only render there — skill mouth-viseme-matching).
7. Leila's voice is locked (`en-US-AnaNeural`, +5%, +20Hz).
TODO: script source format and the stage list (`pipeline.stages.REGISTRY`) — read and fill in; not summarised here.
