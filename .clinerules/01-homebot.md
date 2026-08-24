# Cline rules — HomeBot

**Read `AGENTS.md` in the repo root before your first edit.** It is the full brief and it is short.
Then read the tail of `CLAIMS.md` to see what other agents are building right now.

These rules used to be a single `.clinerules` file. They are now a folder, which
means two things: Cline reads every `.md` here as one combined ruleset, and
`workflows/` holds runnable procedures you invoke by name — `/verify.md`,
`/claim.md`, `/identity.md`. Rules 1 and 3 below have a workflow each; run the
workflow rather than reimplementing it from the prose.

Because this folder exists, Cline no longer falls back to `AGENTS.md` on its own.
That is why the line above is an instruction: read it anyway, it is the brief.

Repeated here because these five cost hours when missed:

1. **Several agents work this repo at once.** Run `git worktree list` and `git status` before any
   mutating git command — three trees are live and `reset --hard` / `checkout --` / `stash` will
   destroy another agent's uncommitted work. Branch off fresh `origin/main`, name it `claude/**`,
   and claim your row in the `CLAIMS.md` track table before you start.

2. **The defect this codebase produces is unreachable capability** — code that exists, works, is
   exported and tested, that no user path ever calls. Every bug in a recent full session was this
   shape. Before finishing, ask *what reaches this?* and trace outward to something a person can
   click, type or say.

3. **CI does not test the app.** It runs at the root; the Electron app is in `widget/` and CI runs
   one of its ~181 test files. Run `cd widget && npx tsc --noEmit && npm run lint && npx jest
   --config=jest.config.ts --runInBand --no-coverage` yourself before claiming anything works.

4. **A control added to `AdvancedSettingsTab` is invisible by default** — Settings opens in Simple.
   This already shipped a live bug.

5. **Credentials, accounts, payments and signing keys are Aden's.** Never enter an API key, create
   an account, or rotate a token — flag it and stop. Never bypass the privacy kill-switch
   (`useCustomLLM` / `allowCloud`); it fails closed by design.

Aden's notes live at `C:\Users\adenk\Documents\Brain\Ai-Brain` — `01_Projects/HomeBot/Plan.md` has
the current tracks and owners. Read it freely; never copy it into the repo.

Prove the symptom is gone before saying it is fixed, and if something fails twice the same way,
stop and change approach rather than retrying.
