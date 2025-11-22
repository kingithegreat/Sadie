# PR: feat(renderer): wire new UI → preload + types

Summary
-------

This branch adds a complete, modern renderer UI snapshot and aligns it with the existing preload API. Key points:

- Introduces a cleaned up chat UI (App + MessageList, MessageBubble, InputBox, Header, SettingsModal).
- Adds renderer-specific types under `src/renderer/types.ts` (ChatMessage, stream payloads, Settings).
- Keeps the preload implementation intact and adds a convenience helper `subscribeToStream(streamId, handlers)`.
- Adds `subscribeToStream` type to `src/shared/types.ts` so both renderer and preload are fully aligned.

Why
---

The new UI mirrors the test harness and E2E expectations (stream chunks, optimistic cancel, retry). The `subscribeToStream` helper centralizes subscription management and reduces boilerplate across the renderer.

Files changed (high level)
-------------------------
- `src/renderer/App.tsx` — new primary UI wired to preload
- `src/renderer/components/*` — Header, MessageBubble, MessageList, InputBox, SettingsModal
- `src/renderer/types.ts` — types for UI and stream payloads
- `src/preload/index.ts` — added subscribeToStream helper
- `src/shared/types.ts` — added subscribeToStream signature

How to verify locally
---------------------
1. From project root:

```powershell
cd widget
npm ci
npx tsc -p tsconfig.json --noEmit
npm test
npm run e2e (optional: Playwright + env)
```

2. Inspect runtime UI by running locally: `npm run dev` in the `widget` folder (requires Electron dev env).

Notes
-----
- I kept the older, feature-rich InputBox components out of the primary App to keep the new UI clean and focused; if you want the previous image/drag/drop features copied in, I can merge them back in.
- Everything is pushed to branch `feature/renderer-ui-wiring`.
