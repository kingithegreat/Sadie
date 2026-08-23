# Copilot instructions — HomeBot

**Read `AGENTS.md` in the repo root before your first edit.** It is the full brief and it is short.
Then read the tail of `CLAIMS.md` for what other agents are building right now.

HomeBot is an Electron 42 / React 18 / TypeScript desktop assistant for **non-technical users**.
Two packages: the root tool registry, and `widget/` — the actual app. Product names are
implementation details in user-facing copy: the first-run screen says "On this PC" and "Online",
not "Ollama" and "Cloud API".

Five things that cost hours when missed:

1. **Several agents work this repo at once.** Check `git worktree list` and `git status` before any
   mutating git command — three trees are live, and `reset --hard` / `checkout --` / `stash` will
   destroy another agent's uncommitted work. Branch off fresh `origin/main`, name the branch
   `claude/**` (CI and auto-merge gate on that glob whatever tool you are), and claim your row in
   the `CLAIMS.md` track table before you start.

2. **The defect this codebase produces is unreachable capability** — code that exists, works, is
   exported and often tested, that no user-reachable path ever calls. Every bug found in a recent
   full-day session was this shape, and every automated gate was green for all of them. Before
   finishing, ask *what reaches this?* and trace outward until you land on something a person can
   click, type or say.

3. **CI does not test the app.** `ci.yml` runs at the root; the Electron app is in `widget/`, and
   CI runs one of its ~181 test files. A green PR does not mean the app compiles. Run it yourself:
   `cd widget && npx tsc --noEmit && npm run lint && npx jest --config=jest.config.ts --runInBand --no-coverage`

4. **A control added to `AdvancedSettingsTab` is invisible by default** — Settings opens in Simple.
   This already shipped a live bug where a user could not find an option that existed.

5. **Credentials, accounts, payments and signing keys are Aden's.** Never enter an API key, create
   an account, or rotate a token — flag it and stop. Never bypass the privacy kill-switch
   (`useCustomLLM` / `allowCloud`); it fails closed by design.

Aden's notes live outside the repo at `C:\Users\adenk\Documents\Brain\Ai-Brain` —
`01_Projects/HomeBot/Plan.md` holds the current tracks, owners and what he has actually asked for.
Read it freely; never copy it into the repo.

Prove a symptom is gone before calling it fixed, and never claim a push that did not happen.
