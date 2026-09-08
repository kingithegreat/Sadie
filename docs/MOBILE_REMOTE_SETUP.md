# Mobile control for the HomeBot workflow

Checked against official documentation on 8 September 2026. This guide does not mean the user's devices have been paired.

## Two different controls

Native ChatGPT/Codex Remote supports Windows and macOS desktop-app hosts. OpenAI's 25 June 2026 release notes explicitly include Windows. Earlier advice that Windows remote access was unavailable was incorrect.

Native Remote is for supported desktop-app chats, not an automatic takeover of an existing Antigravity terminal. For that exact terminal and its current Codex process, use a desktop viewer such as Chrome Remote Desktop.

## Native setup

Update both ChatGPT apps. On the PC, open the desktop app's Settings > Connections > Control this Mac or PC > Set up or Add. Complete verification, scan the displayed QR code with the phone, and use the same account and workspace. Select the PC from Remote in the mobile app.

The CLI and IDE extension cannot initiate this pairing. Availability can depend on rollout and workspace policy. Keep the host awake, online and running the app. Its tools, credentials and permission boundaries remain the execution environment.

First test: request only the repository branch and Git status. Do not edit, commit, push or launch a second coding worker. Confirm that the intended supported task is accessible, then test reconnection over mobile data.

## Exact desktop/terminal access

Google's setup page is https://remotedesktop.google.com/access. Complete Remote Access setup and the PIN on the PC; connect from the official Chrome Remote Desktop Android app. Keep the current terminal open and disconnect the viewer when finished. Do not confuse persistent Remote Access with a temporary Remote Support code.

## Integration and security

Notion remains the planning/progress source. Remote provides phone control; it does not itself prove that a Notion watcher is running. Keep the active local Codex session separate from any proposed noninteractive supervisor until a local handoff is verified. Never start two writers on the same task/worktree.

Protect device pairing and account access. Do not expose Codex app-server, n8n or a browser terminal as an unauthenticated public service. Do not enable telemetry, purchases or production deployment as part of remote setup. Installation approvals, sign-in, PIN entry, QR pairing and real mobile tests remain on-device steps.

## Sources

- https://developers.openai.com/codex/remote/
- https://learn.chatgpt.com/docs/remote-connections
- https://help.openai.com/en/articles/6825453-chatgpt-release-notes (25 June 2026)
- https://support.google.com/chrome/answer/1649523?hl=en&co=GENIE.Platform%3DAndroid
