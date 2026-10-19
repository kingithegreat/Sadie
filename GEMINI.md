# HomeBot — read before your first edit

Gemini CLI and Antigravity load this file. The full rules for every agent are in
[`AGENTS.md`](AGENTS.md); the non-negotiable contract is its [Contract section](AGENTS.md#contract), and it overrides everything else.

Before you build anything:

1. Read `AGENTS.md`, including its Contract section.
2. Read the tail of `CLAIMS.md` **and** run `gh pr list --state open`. If your task is claimed or
   already has a PR, do not start a second version.
3. Claim your row in `CLAIMS.md`, then work in your own worktree off fresh `origin/main` on a
   `claude/**` branch.
4. Prove the change: failing test first, then `tsc`, lint and the full widget suite locally.
5. Never claim done, merged or verified without the command that shows it.

Credentials, accounts, payments, signing keys and publishing are Aden's. Flag them and stop.
