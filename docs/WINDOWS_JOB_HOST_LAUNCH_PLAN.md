# Windows Job host: closing the last same-user launch window

Status: planned (not implemented). Follow-up to the #474 Codex P1 at `workspace-windows-job.ts`.

## What #474 already does

`stageVerifiedWorkspaceWindowsJobHost` reads the installed host once and hashes
those bytes. It writes them to a fresh `mkdtemp` directory, re-verifies the copy
through a held handle, and `spawn()`s only that copy. `confirmLaunched()` then
re-checks the copy's identity and digest. This removes the original window,
where the installed path was verified and then reopened.

## The window that remains

libuv opens files with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`,
and `spawn()` reopens the copy by path. A process running as the same user can,
between `confirmLaunched`'s staging check and `CreateProcess`:

1. rename the verified copy away (allowed because the held handle shares delete),
2. drop its own exe at the same path, so `CreateProcess` maps that one, and
3. rename its exe away and the verified copy back. A running image may be renamed.

`confirmLaunched()` then sees the original file at the path with the original
identity and digest, and passes. The window is small and needs a hostile process
already running as the user, but the check cannot detect it.

## Sound fix (needs native code)

Add a tiny N-API addon, `widget/native/launch-verified` (C++, about 150 lines,
Windows-only, built by node-gyp/@electron/rebuild like better-sqlite3 and node-pty):

1. `CreateFileW(copy, GENERIC_READ, FILE_SHARE_READ, ..., OPEN_EXISTING,
   FILE_FLAG_OPEN_REPARSE_POINT)`. With no `FILE_SHARE_DELETE` and no
   `FILE_SHARE_WRITE`, the file cannot be renamed, deleted or written while the
   handle is open. NTFS also refuses to rename the parent directory while a
   child is open.
2. Hash the bytes through that handle and compare them with the expected SHA-256.
3. Use `GetFinalPathNameByHandleW` to get the path, and refuse it if it differs from the staged path.
4. Call `CreateProcessW` on that path while the handle is still held, so the
   loader must map the same file. Pass the stdio pipes and `CREATE_NO_WINDOW`
   and `CREATE_SUSPENDED`. Then confirm the child image with
   `QueryFullProcessImageNameW` plus a file-ID comparison
   (`GetFileInformationByHandleEx(FileIdInfo)` on both), resume it, and close the handle.
5. Return the pid and the pipe handles, wrapped as Node streams. Alternatively,
   keep `child_process` by letting the addon only hold the deny-share handle
   across a synchronous `spawn()` call. That is the smaller change: it gives the
   same guarantee for steps 1 to 4 and keeps the existing stdio plumbing.

The smaller variant (only hold the handle) is the recommended first step. The
addon exports `holdExclusive(path, sha256) -> { release() }`.
`createPendingWorkspaceWindowsJob` calls it right before `spawn(staged.path)`
and releases it after `confirmLaunched()`.

## Tests

- Unit (Linux, mocked addon): the hold is acquired before spawn and released
  after confirm, a hold failure refuses the launch, and release still happens on
  error paths.
- Windows real test (`workspace-windows-job.real.test.ts`): while the hold is
  active, `fs.renameSync` and `fs.writeFileSync` on the copy and its directory
  throw `EBUSY`/`EPERM`, and the helper still launches and runs one job.

## Why it was not landed now

It needs a C++ addon that only compiles and runs on Windows. It can't be built
or exercised on the Linux box doing this work, and the installer and CI wiring
to prove it on Windows needs workflow-file changes. The agent's token can't push
those (no `workflow` scope). Once that scope exists, implement the smaller
variant above in one PR, kept non-required until the Windows real test passes.
