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

3. **CI does not test the app, and your environment needs one extra flag.** `ci.yml` runs at the
   root; the Electron app is in `widget/`, and CI runs one of its ~181 test files. A green PR does
   not mean the app compiles. Run it yourself, and set `TMPDIR` when you do:

   ```bash
   cd widget
   TMPDIR="$HOME/homebot-test-tmp" npx tsc --noEmit && npm run lint \
     && TMPDIR="$HOME/homebot-test-tmp" npx jest --config=jest.config.ts --runInBand --no-coverage
   ```

   43 test files write fixtures to `os.tmpdir()`, and the main-process file tools refuse any path
   outside `os.homedir()`. On Linux those are `/tmp` and home, so without `TMPDIR` the suite fails
   for environmental reasons, not bugs. Measured on Linux 2026-08-24, same tree, only `TMPDIR`
   differing: **79 failures across 4 suites → 5 failures in 1 suite**.
   `.github/workflows/copilot-setup-steps.yml` installs dependencies and exports `TMPDIR` for you;
   pass it on the command line anyway, because a silent fallback to `/tmp` looks identical to real
   breakage.

   **On Linux, 5 failures in `sd-cpp-setup.test.ts` is the clean result** — `sd-cpp-setup.ts:177`
   refuses on non-Windows by design. Do not try to fix those, and do not report them as a
   regression. Anything beyond those 5 is yours.

   **If the suite will not run, say so.** Write "typecheck clean, unit tests not run in this
   environment" in the PR body. Never write "tests passing" or "verified" for something you did not
   execute — HomeBot ships Windows-only and a few suites assert on literal `C:\...` paths, so an
   honest *unverified* is genuinely useful and a false green is not.

4. **A control added to `AdvancedSettingsTab` is invisible by default** — Settings opens in Simple.
   This already shipped a live bug where a user could not find an option that existed.

5. **Credentials, accounts, payments and signing keys are Aden's.** Never enter an API key, create
   an account, or rotate a token — flag it and stop. Never bypass the privacy kill-switch
   (`useCustomLLM` / `allowCloud`); it fails closed by design.

Aden's notes live outside the repo at `C:\Users\adenk\Documents\Brain\Ai-Brain` —
`01_Projects/HomeBot/Plan.md` holds the current tracks, owners and what he has actually asked for.
Read it freely; never copy it into the repo.

Prove a symptom is gone before calling it fixed, and never claim a push that did not happen.

## Deeper rules load by path

`.github/instructions/` holds instructions scoped with `applyTo` globs, so they arrive only when
you open matching files:

- `widget-verification.instructions.md` (`widget/**`) — the verification command and why `TMPDIR`
  matters
- `renderer-ui.instructions.md` (`widget/src/renderer/**`) — overlay portalling, the Simple/Advanced
  settings trap, chat→panel handoffs
- `main-tools.instructions.md` (`widget/src/main/tools/**`) — the permission-parity gate, boundary
  utils, argv-not-shell, reachability

Read the one that matches what you are editing. They are not optional extras; each is written from
a defect that shipped.
