# SADIE Assistant Context

This file is the stable reference for repo structure and conventions.

Do not use this file as a live task log.

For in-progress work, ownership, touched files, and validation state, use `COPILOT_HANDOFF.md`.
That ledger is shared across Copilot, Gemini Code Assist, Claude Code, and manual contributors.

## Project Identity

- Name: SADIE
- Type: Electron desktop AI assistant
- Runtime: Electron 28 + Node.js
- Language: TypeScript 5.9.3
- Build: `electron-vite`
- Package manager: `npm`
- Repository: `kingithegreat/Sadie`
- Primary app: `widget/`

## Working Agreement

- `COPILOT_HANDOFF.md` is the live coordination file for every agent.
- This file should only contain durable facts that remain useful after a work slice ends.
- If a fact becomes stale, update it here. If it is only about current work, put it in the handoff file instead.

## Key Paths

- `widget/src/main/` main-process code
- `widget/src/preload/` preload bridge
- `widget/src/renderer/` React renderer
- `widget/src/shared/` shared types and constants
- `config/` runtime allowlists and defaults
- `prompts/` routing and safety prompts
- `docs/` product and technical docs

## Common Commands

```bash
cd widget
npm run dev
npm run build
npm run dist
npm run e2e
npm run test:file -- <pattern>
```

From the repo root, prefer `npm --prefix "C:\Users\adenk\Desktop\sadie\widget" <command>` because the top-level package does not expose the widget dev flow directly.

## Current Durable Conventions

- Electron IPC is registered in `widget/src/main/ipc-handlers.ts` and exposed through `widget/src/preload/index.ts`.
- Tool registration and permission preflight live in `widget/src/main/tools/index.ts`.
- Intent routing and tool orchestration live in `widget/src/main/message-router.ts`.
- First-run onboarding lives in `widget/src/renderer/components/FirstRunModal.tsx`.
- Web service windows are managed in `widget/src/main/web-services.ts`.
- Main window creation and widget-mode behavior live in `widget/src/main/window-manager.ts`.

## Update Rule

Only add information here if it would still help a future agent after the current task is complete.
