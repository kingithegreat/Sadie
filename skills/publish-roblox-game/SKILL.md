# Publish Roblox Game — Go-Live Checklist

Domain knowledge for getting a Roblox experience actually **live and playable**
(not just "published"). Learned the hard way on the kingithegreat portfolio:
several games were declared "live" on the strength of a publish returning HTTP 200,
and were still broken or invisible.

## Triggers
- publish roblox
- make roblox game public
- roblox go live
- roblox audience public
- content maturity
- roblox game not showing
- roblox game private
- roblox open cloud publish
- roblox 401 publish

## Context
When activated, this text is appended to the system prompt:

Getting a Roblox experience LIVE is a multi-step gate, not a single toggle. Never
tell Aden a game is "live" until these are true — and never fake any step.

1. **The Public toggle is NOT enough.** In the Creator Dashboard
   (create.roblox.com → experience → Settings/Configure), flipping **Audience → Public**
   and saving does NOT make the game playable on its own. Roblox requires a completed
   **content-maturity questionnaire** (age label) per experience first. Without it the
   game stays effectively Private and shows the default blue thumbnail.

2. **Do NOT fill out the maturity questionnaire blind.** It is a content declaration
   (violence, blood, romance, gambling, language, alcohol/drug references, etc.) that
   only Aden can answer accurately. Wrong answers are a moderation risk on his account.
   Read him the questions, get his answers, then submit — never guess.

3. **A publish returning HTTP 200 means the file reached Roblox — nothing more.**
   `luau-compile` accepts syntactically-valid-but-fatal code. **Assume every
   unplaytested game is broken until a human has joined a live server.** Empty test
   servers dying off on their own is normal and is not proof of anything.

4. **Open Cloud key scope (the 401 trap).** Batch-publishing uses the
   `ROBLOX_PUBLISH_BATCH` Open Cloud key. A **401** on publish almost always means the
   target universe isn't in the key's Access Permissions: Creator Dashboard → Open Cloud
   → API Keys → the key → Access Permissions → universe-places → **add the universe with
   Write** → Save. (Known case: Dig Site, universe 10571759336.)

5. **Structural safety — bake a SpawnLocation.** If the place builds its whole world at
   runtime with no baked baseplate/SpawnLocation, a map-build failure drops players into
   the skybox (the "void death-loop"). Ensure MapBuilder is `pcall`'d with a fallback
   room AND the place file itself contains a real SpawnLocation.

6. **Discoverability, once it works.** A live game still needs a store listing to get
   players: an icon + thumbnails (biggest click-through lever), accurate tags, and a
   description with the hook up front. Ship 2–3 icon/thumbnail variants and let analytics
   pick the winner.

**Go-live order:** rescope the Open Cloud key (fix any 401) → publish → **playtest on a
real device** → complete the content-maturity questionnaire with Aden's answers →
Audience → Public → store listing (icon/thumbnails/tags/description). Only after a human
has played it do you call it live.
