---
name: stateful-fix-patterns
description: Failure patterns in fixes that touch persisted state, saved settings, or external CLIs — fixes that only work for new data and leave existing users broken, asymmetric flag writes, non-idempotent transforms, recovery loops, and assumptions about how a provider is reached. Use when changing a settings field, a persisted flag, an encryption or migration path, or when adding a provider that is a subprocess rather than an HTTP endpoint; and when a user reports "I changed the setting and nothing happened" or "it's still doing the old thing after I restarted".
---

# Fixes that touch state

Companion to `homebot-defect-patterns`, which covers **wiring** — code that
isn't reachable. This one covers **state**: code that is reachable, runs, and
still leaves the user broken, because the data on their disk was written by an
older version of the rule.

Every pattern here was observed live in one day. **Four of the six were
introduced by a previous fix in the same session** — the fix was correct for
new data and did nothing for existing data. That is the theme: *a change to the
rule is not a change to the state already written under the old rule.*

## Before you call a state fix done, ask

1. **Does this repair existing data, or only new data?** If a user must perform
   an action to trigger the repair, it is not a fix — see pattern 1.
2. **If this writes a flag, what clears it?** See pattern 2.
3. **Can this transform run twice on its own output?** See pattern 3.
4. **If recovery writes a file, does the next read still fail?** See pattern 4.
5. **Does this assume the provider is an HTTP endpoint?** See pattern 6.
6. **Did I run it, not just test it?** Patterns 5 and 6 are invisible to a
   green suite.

---

## 1. A fix that needs the user to act is not a fix

**Shape.** The bug is in persisted state. The fix corrects the code that
*writes* that state. New writes are fine; the value already on disk stays
wrong, forever, unless the user happens to perform the action that rewrites it.

**Live case.** The model picker wrote `customLLM.enabled: true` when a cloud
model was chosen but never wrote `false` when a local one was. Fix #92 made the
write symmetric — correct, and useless: the header already displayed "Qwen", so
the user had no reason to re-pick, and the stale `enabled: true` kept routing to
opus. It was reported **three separate times**, each after a relaunch, each
time with me saying "this one's fixed".

**Rule.** When a fix targets persisted state, you must do one of:

- **change the read rule** so old data is interpreted correctly (what finally
  worked: an explicit `useCustomLLM` boolean now always wins over a stale
  `enabled` flag), or
- **migrate the data** on next load, or
- **repair the specific user's file** and say so.

Shipping only the write-side fix means "works on my machine, and on nobody
else's until they get lucky."

**Tell.** You are about to write "relaunch and try again" for the second time.

---

## 2. Asymmetric flag writes

**Shape.** Two mutually exclusive choices, but only one of them writes state.
Choice A sets a flag; choice B forgets to clear it. The system now has a state
that says both.

**Live case.** Cloud pick → `enabled: true`. Local pick → nothing. Once a cloud
model had ever been selected, local was unreachable.

**Rule.** Any handler that sets a flag for one branch must explicitly set it for
every other branch. Not "leave it alone" — *set it*. Then assert both directions
in tests; one-directional coverage is how this survives review.

**Related.** Prefer deriving from a single source over storing two flags that
can disagree. `useCustomLLM || enabled` was an OR over two sources of truth, and
the OR is what preserved the bug.

---

## 3. Non-idempotent transforms compound

**Shape.** A transform (encrypt, encode, wrap, prefix) is applied on save. The
saved value is later loaded and saved again — and the transform runs on its own
output, because nothing marks a value as already transformed.

**Live case.** `encryptSecret()` had no ciphertext marker, so every save
re-encrypted the previous ciphertext. Each pass grew the value ~33%. Found as a
`user-settings.json` whose `customLLM.apiKey` was **180,106,622 characters** —
180MB of nested encryption in a settings file.

**Rule.** Any transform that can meet its own output needs a marker
(`enc:v1:`), and the function must be a no-op when it sees one. Add a size cap
as the backstop, applied to *every* field of that kind — the incident happened
under whichever key lacked the guard.

**Bonus.** Recovery for already-damaged values: decrypt *until stable*, bounded,
so multiply-wrapped legacy data comes back to plaintext instead of surfacing as
garbage.

---

## 4. Recovery that doesn't repair loops

**Shape.** Code detects corrupt data, archives it, logs it, and returns a safe
default — but leaves the corrupt data in place. The next read finds the same
corruption and repeats the whole ritual.

**Live case.** A settings file that failed to parse was backed up to
`user-settings.json.corrupt-<ts>.json` on every cache expiry. The user's config
folder held **42 archives, stamped ~30 seconds apart.**

**Rule.** Recovery must leave the system in a state where the next read
succeeds. Archive once, then **write the repaired file**. Test it by reading
twice and asserting only one archive exists.

---

## 5. Encoding is not corruption

**Shape.** A parser treats a valid-but-unexpected encoding as damage and
triggers destructive recovery.

**Live case.** A UTF-8 BOM — written by PowerShell's `Out-File`, which is what
*I* used to repair the file — made `JSON.parse` throw. The app declared the
settings corrupt and reset the user to defaults, losing their configuration.

**Rule.** Strip a BOM before parsing JSON on Windows. More generally: before
treating data as corrupt, rule out the boring encoding explanations. Destructive
recovery needs a higher bar than "the parser said no".

**Also.** Prefer writing files with tools that don't add a BOM. If you repair a
user's file by hand, verify it *parses* afterwards — with the same parser the
app uses.

---

## 6. "Cloud provider" does not mean "HTTP endpoint"

**Shape.** Code builds a URL from a provider map and POSTs to it. It works for
every provider that *is* an endpoint, and breaks for any that isn't — a local
CLI, a subprocess, a socket.

**Live case.** Three features each hand-rolled
`cfg.apiUrl || PROVIDER_API_URLS[cfg.provider] || ''` and posted to it. The
`claude-code` provider is a CLI with no URL, so the expression produced `''`
and the user saw **"Invalid URL"** in the Quiz panel. The same shape had already
caused "API URL is required" in the Connect flow a week earlier.

**Rule.** Route one-shot generations through the single dispatcher that already
knows every provider (`generateFromCustomLLM` → `streamFromCustomLLM`) rather
than adding a branch per feature. If you find yourself writing a fourth copy of
a provider `switch`, the abstraction is missing.

**Pin the root cause.** A test asserts `PROVIDER_API_URLS['claude-code']` stays
`undefined`. Adding a placeholder URL would make the symptom vanish while
posting into the void — the test exists to reject that shortcut.

---

## Subprocess providers on Windows

Two failures that a green test suite cannot see, both found by *running* the
CLI:

**`spawn EINVAL` on `.cmd`.** npm global binaries install as `codex.cmd`, and
modern Node refuses to spawn `.cmd`/`.bat` without `shell: true`
(CVE-2024-27980). `claude.exe` is a real executable and doesn't hit this, so the
pattern is easy to miss when copying a working provider.

**Never put the prompt in argv.** `shell: true` concatenates arguments
*unescaped*. A prompt containing `&` or `|` would execute commands. Pass the
prompt over **stdin** (`codex exec -`) so no untrusted byte reaches the command
line; only your own literal flags remain in argv.

**Close stdin.** A CLI may read stdin for extra context even when given a
prompt argument, and will wait forever if the pipe stays open. From a terminal
this is invisible — the shell already closed stdin for you. Under `spawn()` it
hangs. Always `child.stdin.end()`.

**Verification that actually works here:** run the CLI through a throwaway
Node script using the *same* `spawn` shape as production, A/B with and without
the fix, and confirm exit code plus parsed output. Every one of these three was
found that way and none would have been caught by the suite.

---

## Verification standard for state changes

- **Read the user's real file** before and after. Report presence and length of
  secrets, never their values.
- **A/B the claim.** Stash the change, re-run, confirm the failure returns.
  Twice this session a suspected regression turned out to be a pre-existing
  failure, and once a "fixed" suite was still red for a different reason.
- **Grep the shipped bundle**, not the source, for anything that must survive
  bundling.
- **State what is unverified.** "Not yet run in the live app" is a complete
  sentence and belongs in the commit message.
