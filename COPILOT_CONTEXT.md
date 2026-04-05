# SADIE — Copilot Context

Master context document for GitHub Copilot and AI coding assistants working on this codebase.

---

## Project Identity

- **Name**: SADIE (Smart AI Desktop Interactive Engine)
- **Type**: Desktop AI assistant
- **Version**: 0.9.0
- **Language**: TypeScript 5.9.3 (strict mode)
- **Runtime**: Electron 28 + Node.js
- **Build System**: electron-vite (NOT Webpack)
- **Package Manager**: npm
- **Repository**: `kingithegreat/Sadie` on GitHub
- **Branch**: `main`

---

## Project Structure

```
Sadie/
├── widget/                         # Main Electron application
│   ├── src/
│   │   ├── main/                   # Main process (Node.js)
│   │   │   ├── tools/              # Tool handler modules
│   │   │   │   ├── index.ts        # Tool registry and executor
│   │   │   │   ├── nba.ts          # NBA/sports data
│   │   │   │   ├── filesystem.ts   # File operations
│   │   │   │   ├── vision.ts       # Computer vision
│   │   │   │   ├── web-search.ts   # Web search
│   │   │   │   ├── code-runner.ts  # Code execution
│   │   │   │   ├── reminder.ts     # Reminders
│   │   │   │   ├── rag.ts          # RAG indexing
│   │   │   │   └── ...             # 20+ tool modules
│   │   │   ├── __tests__/          # 70+ main-process test suites
│   │   │   ├── message-router.ts   # Intent detection, tool routing, LLM orchestration
│   │   │   ├── tool-helpers.ts     # Tool extraction and validation
│   │   │   ├── ipc-handlers.ts     # IPC channel registration
│   │   │   ├── config-manager.ts   # Settings persistence
│   │   │   ├── memory-manager.ts   # Memory and RAG
│   │   │   ├── custom-llm-client.ts # Cloud LLM provider
│   │   │   ├── logger.ts           # Logging with buffer caps
│   │   │   └── index.ts            # Electron app entry point
│   │   ├── renderer/               # React UI (Vite + HMR)
│   │   │   ├── components/         # React components
│   │   │   ├── styles/             # CSS (dark/light/system themes)
│   │   │   ├── e2e/               # Playwright E2E specs
│   │   │   └── __tests__/          # 25+ renderer test suites
│   │   ├── preload/                # Context bridge (sandbox-safe IPC)
│   │   │   └── index.ts
│   │   └── shared/                 # Types, constants, utilities
│   │       ├── constants.ts        # Exported constants (MODEL_METADATA, etc.)
│   │       └── types.ts
│   ├── electron.vite.config.ts     # Build configuration
│   ├── electron-builder.yml        # Installer packaging
│   ├── jest.config.ts              # Jest configuration
│   ├── playwright.config.ts        # E2E configuration
│   ├── tailwind.config.js          # Tailwind CSS
│   └── package.json
├── config/                         # Runtime configuration
│   ├── api-allowlist.json          # Permitted API domains
│   ├── tool-allowlist.json         # Permitted tools
│   ├── safety-rules.json           # Safety filter rules
│   ├── ollama-models.json          # Model definitions
│   ├── mcp-servers.json            # MCP server config
│   └── default-config.json         # Default settings
├── prompts/                        # System prompts
│   ├── sadie_system.txt            # Main system prompt
│   ├── intent_detection.txt        # Intent classification
│   ├── safety_rules.txt            # Safety directives
│   └── tool_call_template.json     # Tool call format
├── schemas/                        # JSON schemas
│   ├── tool-call-schema.json       # Tool invocation schema
│   ├── file-operation-schema.json  # File op schema
│   ├── memory-operation-schema.json # Memory op schema
│   └── vision-request-schema.json  # Vision request schema
├── n8n-workflows/                  # n8n workflow definitions
├── scripts/                        # Build and utility scripts
├── docs/                           # Technical documentation
└── memory/                         # Local memory store
```

---

## Key Conventions

### TypeScript

- Strict mode enabled (`strict: true` in tsconfig).
- All new code must pass `npx tsc --noEmit`.
- Use `import type` for type-only imports.
- Prefer `const` over `let`; avoid `var`.

### Testing

- **Command**: `cd widget && npx jest --config jest.config.ts --no-coverage`
- **Current count**: 112 suites / 1,604 tests
- Test files live alongside source code in `__tests__/` directories.
- Use `jest.mock()` for all external dependencies.
- Use `/** @jest-environment jsdom */` for renderer tests.
- Use `/** @jest-environment node */` for main-process tests.

### IPC Communication

- All IPC channels are registered in `ipc-handlers.ts`.
- Preload script validates channel names against an allowlist.
- Use `ipcMain.handle` / `ipcRenderer.invoke` (request-response pattern).
- Use `webContents.send` / `ipcRenderer.on` for streaming (main → renderer).

### Tool System

- Tools are registered in `src/main/tools/index.ts` via `registerTool()`.
- Each tool has: `name`, `description`, `handler`, `requiredPermissions`.
- Intent detection (regex + keyword) in `message-router.ts` routes to tools.
- Tool results are synthesised by the LLM into natural language.

### Safety

- All user input passes through the 7-layer safety pipeline.
- New tools must declare `requiredPermissions`.
- External network calls must check `config/api-allowlist.json`.
- File operations must validate paths against traversal attacks.

---

## Models

### Local (Ollama)

| Model | Purpose |
|---|---|
| `llama3.2:3b` | Primary chat model |
| `qwen2.5-coder:3b` | Code generation |
| `llava:latest` | Computer vision |
| `dolphin-llama3:8b` | Uncensored mode (optional) |

### Cloud (Optional)

| Provider | Models |
|---|---|
| **OpenAI** | GPT-4o, GPT-4o Mini |
| **Anthropic** | Claude Opus 4, Claude Sonnet 4, Claude 3.5 Haiku |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash |
| **xAI** | Grok-3 |
| **DeepSeek** | DeepSeek V3 |

Cloud model token limits are defined in `MODEL_METADATA` (exported from `shared/constants.ts`).

---

## Key Files for Common Tasks

| Task | Files |
|---|---|
| Add a new tool | `src/main/tools/index.ts`, `src/main/tools/<name>.ts` |
| Change tool routing | `src/main/message-router.ts` |
| Add IPC channel | `src/main/ipc-handlers.ts`, `src/preload/index.ts` |
| Change system prompt | `prompts/sadie_system.txt` |
| Add cloud model | `src/shared/constants.ts` (MODEL_METADATA) |
| Add UI component | `src/renderer/components/` |
| Add CSS theme | `src/renderer/styles/` |
| Add test | `src/<process>/__tests__/<name>.test.ts` |
| Configuration | `config/*.json` |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `SADIE_E2E` | When `"true"`, enables test-only code paths |
| `NODE_ENV` | `development` / `production` / `test` |
| `OLLAMA_HOST` | Custom Ollama endpoint (default: `http://localhost:11434`) |

---

## Build Commands

```bash
cd widget
npm run dev          # Development with HMR
npm run build        # Production build (electron-vite)
npm run dist         # Create NSIS installer
npm run e2e          # Run Playwright E2E tests
npx jest --config jest.config.ts --no-coverage   # Unit tests
npx tsc --noEmit     # Type check
```

---

## Hardware-Aware Model Recommendations

SADIE includes GPU VRAM detection and a recommendation engine that guides users to the best setup for their hardware.

### Key Files

| File | Role |
|---|---|
| `widget/src/main/moa.ts` | MoA engine, `recommendConfig()`, `recommendMoAPreset()`, presets, `SINGLE_MODEL_RECOMMENDATIONS` |
| `widget/src/main/ipc-handlers.ts` | `sadie:detect-gpu-vram` IPC handler — calls `detectGpuVram()` + `recommendConfig()` |
| `widget/src/shared/types.ts` | `ElectronAPI.detectGpuVram` return type (includes `mode`, `preset`, `model`, `reason`) |
| `widget/src/renderer/components/SettingsPanel.tsx` | GPU detection UI, VRAM slider, recommendation display, Apply button |
| `widget/src/main/tools/rag.ts` | RAG (TF-IDF indexing + cosine similarity search) — recommended for all VRAM levels |

### Recommendation Logic (`recommendConfig(vramGB)`)

| VRAM | Mode | Recommendation |
|---|---|---|
| ≥ 10 GB | `moa` | Code-focused preset (3 × 7B proposers + 7B aggregator) |
| ≥ 8 GB | `moa` | Balanced preset (3 mixed proposers + 7B aggregator) |
| 4–7 GB | `single` | `qwen2.5:7b` single model + RAG |
| 2–3 GB | `single` | `llama3.2:3b` single model + RAG |
| < 2 GB | — | `null` (insufficient VRAM) |

### Design Rationale

MoA needs at least 8 GB VRAM to outperform a single model. Below 8 GB, running multiple small models (e.g. two 3B proposers + 3B aggregator) produces worse output than a single 7B model and takes 2-3× longer. The `MOA_MIN_VRAM_GB = 8` constant enforces this threshold. For low-VRAM users, RAG (drag-and-drop file indexing) gives the biggest quality boost without VRAM cost.

---

## Common Patterns

### Adding a New Tool

```typescript
// src/main/tools/my-tool.ts
export async function handleMyTool(args: MyToolArgs): Promise<string> {
  // Implementation
  return 'Result';
}

// src/main/tools/index.ts
registerTool({
  name: 'my_tool',
  description: 'What this tool does',
  handler: handleMyTool,
  requiredPermissions: ['read'],  // or ['write'], ['execute'], etc.
});
```

### Adding Intent Detection

```typescript
// src/main/message-router.ts
// In the intent detection section:
if (/my keyword|my pattern/i.test(userMessage)) {
  return { tool: 'my_tool', args: { /* extracted args */ } };
}
```

### Adding a Renderer Test

```typescript
// src/renderer/__tests__/my-component.test.tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../components/MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected')).toBeInTheDocument();
  });
});
```
