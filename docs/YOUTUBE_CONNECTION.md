# YouTube desktop connection

HomeBot's **Connect → YouTube** card imports the owner's Google Desktop app
JSON, opens Google sign-in in the system browser, and displays the account's
YouTube channels. **Check connection** refreshes access when needed. This step
reads channel identity only; uploads, scheduling, analytics and comments are
separate future work.

## Owner setup

1. Finish the Google Auth Platform app information, audience and contact steps.
   For a personal Google account, use External and add that account as a test
   user while the app is in Testing.
2. Enable **YouTube Data API v3** in that Google Cloud project. Create an OAuth
   client with application type **Desktop app** and download its JSON file into
   your user folder, such as Downloads.
3. Run this updated HomeBot build. Keep **Production Studio** enabled in Modules
   and enable **Online** in Settings.
4. Open **Connect → YouTube → Choose Google JSON**. Select the downloaded file,
   then click **Sign in with Google** and review Google's permission request.
5. Return to HomeBot and check the channel shown. A saved sign-in after restart
   is labelled with its last check time. Click **Check connection** to confirm
   access again.

The Gemini API key is a separate model credential, entered in model settings;
it cannot replace the Desktop app JSON. Real credentials and Google consent
are entered by the owner, not an agent. No real credential was used to verify
this implementation.

Google references: [Desktop application OAuth](https://developers.google.com/youtube/v3/guides/auth/installed-apps),
[channels.list](https://developers.google.com/youtube/v3/docs/channels/list),
[Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key).

## Recovery

- **Cancel sign-in** closes the temporary callback and leaves an existing grant
  intact. Disabling Online or Studio also cancels an active attempt.
- **Remove from HomeBot** deletes this PC's client and tokens. An unreadable
  saved grant exposes **Remove saved connection** so setup can start again.
- Local removal does not revoke Google's account permission. The card links
  to Google's account-connections page for that owner action.
- A denied channel request explains how to enable the API and allow access.
  Expired/revoked tokens require sign-in again. No channel is shown as connected
  until both token exchange and the actual channel request succeed.

## Boundaries

The existing Studio gateway validates the main window/frame, accepts no
renderer-supplied arguments, and checks module availability. The native file
picker stays in main; imports must resolve inside the owner's home folder and
be at most 64 KiB. Only `installed` desktop-client JSON is accepted. Endpoint
and redirect fields from that file are ignored.

The adapter requests `youtube.readonly`, pins Google's HTTPS endpoints, uses
PKCE S256 and a random state, and binds a temporary `127.0.0.1` callback on a
random port. It checks host, path, method and state, closes on completion or
cancellation, and rejects redirects, oversized responses and malformed tokens.
Existing Online consent is checked before browser/network work, before each
request, and after asynchronous steps. Disabling/removing during a request
cannot restore a stale grant.

Scoped credentials use the existing config manager and Electron `safeStorage`.
There is no new secret-store file or renderer secret API. New grants fail
closed without OS encryption, including Linux's `basic_text` fallback.
`getSettings` and ordinary settings export omit the encrypted private map;
whole-settings saves preserve its latest main-process value and ignore an
injected renderer copy. Tokens, client secrets, callback codes and remote error
bodies do not cross the public connection IPC.

## Verification — Windows, 9 September 2026

- Full widget Jest: **279 suites / 3,901 tests passed**, 15 existing skipped
  tests; existing CI `--forceExit` setting. Root: **18 suites / 227 tests passed**.
- Both TypeScript checks, Electron build, docs synchronization, module import
  boundaries and duplicate-export checks passed. Lint: zero errors and eight
  existing warnings outside the changed files.
- Rebuilt Electron: YouTube and module-controls tests **2 passed in 35.1 s**,
  retries disabled. The YouTube flow exercised actual Connect navigation,
  native-picker dispatch, real loopback callback and Windows DPAPI, channel
  rendering, restart, refresh-token reuse, Online/module denial, removal and
  recovery from corrupt ciphertext. The connected screen was visually reviewed.
- Google browser/HTTP responses are synthetic fixtures. These checks prove the
  shipped application path and storage behavior; live Google acceptance and
  the owner's channel remain unverified. On systems without a secure OS
  backend, the E2E verifies refusal instead of substituting a fake cipher.

Committed test paths:

- `widget/src/main/__tests__/youtube-connection.test.ts`
- `widget/src/main/__tests__/youtube-connection-ipc.test.ts`
- `widget/src/main/__tests__/integration-secrets.test.ts`
- `widget/src/renderer/__tests__/youtube-connection-card.test.tsx`
- `widget/src/renderer/__tests__/connections-panel.test.tsx`
- `widget/src/renderer/e2e/youtube-connection.e2e.spec.ts`
- `widget/src/renderer/e2e/module-controls.e2e.spec.ts` (existing regression)

The first Electron attempt failed because the test searched for a navigation
label of “Connections” instead of the visible “Connect”. Correcting that
selector exposed and exercised the real screen. The renderer suite also exposed
an existing server-list mock leaking between tests; resetting the list in
`beforeEach` restores independent tests. No application timeout or gate was
relaxed. Remote CI and merged-content evidence are tracked in the PR and the
[Notion claim](https://app.notion.com/p/3d6829ebf7be81f3a9f2c96656655dc9).
