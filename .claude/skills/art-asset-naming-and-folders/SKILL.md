---
name: art-asset-naming-and-folders
description: Where character assets live and how they must be named so the pipeline finds them.
when_to_use: Saving, moving or referencing any character sprite, sheet, mouth tile or plate.
---
# Art asset naming and folders

Sources: AP `CLAUDE.md` ("Filenames are load-bearing"), `docs/CHARACTER_DESIGN_BIBLE.md`, AP `workspace/branding/characters/` listing, `docs/REMAINING_ART.md`.

- Root: AP `workspace/branding/characters/<name>/`, `<name>` = **speaker name lowercased** (e.g. `leila`, `flappy`, `imhotep`, `dhara`). Mismatch renders nothing, with no error.
- Inside (verified for leila): `turnaround/ pose_a/ pose_b/ expression_a/ expression_b/ head_turn/ body_mechanics/ mouth/ manifest.json`; cell files named by cell, e.g. `turnaround/front.png`, `mouth/A.png`.
  (CHARACTER_DESIGN_BIBLE shows older names `facial_expressions/`, `mouth_shapes/`, `full_poses/` — the on-disk tree uses the panel names above.)
- Sheets sit beside the folder: `<name>_model_sheet.png` (also seen: `<name>_sheet.png`, `flappy_puppet_sheet.png`, `flappy_parts/`).
- Save as real PNG bytes with `.png` (a JPEG named .png broke a nightly). A plate on disk but unregistered renders nothing.
- Never overwrite accepted assets: write a revisioned copy and let the owner swap it in. Never `git add -A` in AP (≈1 GB media); AP is commit-locally, never push.
- R1a outputs land per ticket: `MyDrive/Ancient_Pathways/movie_queue/tickets/` → `<shotDir>/image/<shotId>.png` (or the ticket's `relativeOutputPath`).
- PROPOSED (art audit 2026-10-20, AP owner only, after R1a goes live): `body/<orientation>/<pose>.png`, `expressions/<orientation>/<expression>.png`, `mouths/<orientation>/<family>/<viseme>.png`, guests under `guests/<name>/`; lowercase snake_case, no generator hashes. Moving files needs AP config + HomeBot `ancient-pathways.ts` updates — not done.
- TODO: revision suffix convention for candidates (e.g. `front.r2.png`?) — not found; ask Aden.
