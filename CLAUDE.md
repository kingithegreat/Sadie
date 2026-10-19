@AGENTS.md

# HomeBot — Claude reads this file

The line above imports [`AGENTS.md`](AGENTS.md), the single source of rules for every model.
The non-negotiable operating rules that used to be here (the Drive-plan cadence and rules 1–16)
moved verbatim to its [Contract section](AGENTS.md#contract); they still bind you and override
everything else. Skills: [`.agents/skills/`](.agents/skills/) (mirrored in `.claude/skills/`).
Add new rules to AGENTS.md, not here, so every model sees them.
