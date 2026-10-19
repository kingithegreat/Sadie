# SYNC — keeping Drive and the repo in step

| What | Lives in | Owner of truth |
|---|---|---|
| Priorities, queue, owner decisions, acceptance (PASS/FAIL) | Drive "HomeBot — Current Plan" (`05_HomeBot`) | Drive |
| Rules, skills, how-tos | Sadie `AGENTS.md`, `agent-skills/` | **Repo** |
| Who is working on what now | `CLAIMS.md` | Repo |
| Technical snapshot | `docs/CURRENT_STATUS.md` | Repo |

1. **Skills flow repo → everywhere.** Edit a skill only by PR to Sadie. Copies elsewhere
   (`~/.claude/skills`, `~/.agents/skills`, `~/.gemini/config/skills`, ChatGPT/DeepSeek
   project files, any Drive copy) are generated from the repo and never edited in place.
   On Aden's PC the existing `C:\Users\adenk\.agents\sync-shared-skills.ps1` does the local
   fan-out — TODO: point it at `<sadie>/agent-skills` as its source (unverified what it reads today).
2. **Plan flows Drive → repo by reference, not copy.** The repo links to the Drive doc; it
   does not mirror its rows. When a Drive decision changes a rule (e.g. "Pollinations is dead"),
   the agent who notices opens a PR updating AGENTS.md/the skill and cites the Drive date.
3. **Progress flows repo → Drive.** After verified work merges, update the Drive plan row
   (skill `drive-plan-update`) with PR #, merge SHA, evidence path, next step.
4. **Conflict rule.** Drive wins on *what/when/who*; repo wins on *how*. If they contradict,
   stop and ask Aden; record the answer in both places.
5. **Paste-in models** (ChatGPT, DeepSeek) get `PROJECT_INSTRUCTIONS.md` plus the relevant
   SKILL.md files; re-paste when `git log -- agent-skills PROJECT_INSTRUCTIONS.md` shows changes.
   TODO: optional version line at the top of PROJECT_INSTRUCTIONS.md so stale pastes are visible.
