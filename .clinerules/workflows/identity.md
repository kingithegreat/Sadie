# /identity — sign your commits as yourself

Run this once per workspace, before your first commit.

```bash
git config user.name  "ox-alpha"
git config user.email "ox-alpha@users.noreply.github.com"
git config --get user.name && git config --get user.email
```

## Why this is not cosmetic

Across this repo's whole history, 686 commits are authored by
`kingithegreat <adenk@example.com>` — a single shared identity used by several
different agents and sessions. Exactly one commit is attributable to `ox-alpha`.

`CLAIMS.md` credits ox-alpha with owning the Media Studio track and "8 of the
last 15 PRs", and git can neither confirm nor deny it, because those commits are
signed with the shared identity. So nobody — human or agent — can answer "who
wrote this, and is their work holding up?" It also makes `git log --author` and
`git blame` useless for the one question worth asking after a regression.

Repo-local config (no `--global`) so this workspace's commits carry your name and
nothing else on the machine changes. Keep the `@users.noreply.github.com` address
— it attributes correctly on GitHub without publishing a real inbox.

Aden's own commits stay his. Do not set this to his name or address.
