---
name: character-art-spec
description: What a character art kit must contain (Leila/Flappy and guests), how it is laid out, and the only approved way to generate it.
when_to_use: Requesting, generating, reviewing or accepting any character art for Ancient Pathways / Media Studio.
---
# Character art spec

Sources: Aden decisions 2026-10-20; HomeBot art audit 2026-10-20; AP `STYLE_GUIDE.md`, `docs/CHARACTER_DESIGN_BIBLE.md`, `docs/RIG_PLAN.md`, `CLAUDE.md`; Sadie `notebooks/colab_sdxl_ipadapter.ipynb`, CLAIMS.md (R1a/Kaggle row, gemini-default-image row); Drive plan §3.

## Lane (non-negotiable)
- **R1a**: Colab T4 SDXL fp16 + IP-Adapter-plus on locked references; ControlNet only when per-cell identity drifts. Kaggle notebook = approved alternate host; Colab stays the lane.
- Ground **pure magenta `#FF00FF`**; prompts without it are refused. Reject any cell with a magenta border/residual.
- **R1a is the only character-art lane** (Aden, 2026-10-20). No Pollinations, no paid Gemini/Imagen, no OpenAI image for characters. Any other paid API still needs Aden's explicit approval of the spend.
- **No text in art** (no labels, captions, letters — the mouth row once came back as the letters "A E I O U M B L").
- Do not regenerate already-accepted slots; reuse existing prompts/references. A file or executor label is not owner approval.

## Full kit — leads (Leila, Flappy). Model sheet 1536×1024, panel positions per `LEILA_PANELS` in AP `pipeline/anim/spritesheet.py`
| Panel | Cells |
|---|---|
| turnaround | front, three_quarter_front, side, three_quarter_back, back |
| pose_a | idle, walking, running, jumping, waving |
| pose_b | pointing, thinking, happy, sitting, reading |
| expression_a | neutral, happy, excited, laughing |
| expression_b | thinking, surprised, sad, angry |
| head_turn | front, three_quarter_left, left, three_quarter_right, right |
| mouth | A, E, I, O, U, M, B, L |
| body_mechanics | standing_confident, hands_clasped, skirt_swish, looking_up, listening, cheerful_arms_up |
Rig work additionally needs separated parts (upper arm, forearm, hand with rounded joint caps, measured anchors) — rig owner only (MS-RIG-0).

## Guest kit (Aden, 2026-10-20)
- **1 front pose + 1 side pose** (reuse existing `turnaround/front` / `turnaround/side` where they pass QA).
- **5 cycled expressions**: neutral, happy, thinking, surprised, serious — drawn for both orientations.
- **Matching mouths per orientation**: a mouth set for front and a separate one for side, matched to the expression family. Generating/compositing them is PROPOSED and pending the AP owner (see mouth-viseme-matching); until then side poses carry no mouth.
- Proportions: chibi storybook, head-to-height ~1:3 matching Leila; S2 guests were too elongated and get redrawn at S1 proportions. Guests built to the 1536×1024 layout are sliced by existing code.
- Mirror for the opposite side only where the costume is symmetric. (Sizing per the 2026-10-20 art audit: ~42 images per guest, 9 guests.)

## Acceptance
Open the art and look at it beside Leila's sheet. Check identity, proportions, magenta ground, no text, no caption band. Aden accepts; record in Drive.
