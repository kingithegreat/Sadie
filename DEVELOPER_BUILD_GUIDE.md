# SADIE Developer Build Guide

A comprehensive guide for developers setting up SADIE for local development, testing, and contribution.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Testing](#testing)
5. [Code Changes and Rebuilding](#code-changes-and-rebuilding)
6. [Safe Development Practices](#safe-development-practices)
7. [Debugging](#debugging)
8. [Contributing](#contributing)

---

## Prerequisites

### System Requirements

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18.0 or higher | Tested with v24.13.0 |
| **npm** | 9.0 or higher | Ships with Node.js |
| **Git** | Latest | Version control |
| **Ollama** | Latest | Local AI model hosting |
| **Docker Desktop** | Latest | For n8n (optional) |
| **OS** | Windows 10+ | Primary development platform |

### Hardware Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| **RAM** | 8 GB | 16 GB |
| **GPU** | Integrated (CPU-only) | NVIDIA RTX 2050+ (4 GB VRAM) |
| **Storage** | 15 GB free | 25 GB free |
| **Network** | Required for initial setup | Optional after models downloaded |

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/kingithegreat/Sadie.git
cd Sadie
```

### 2. Install Dependencies

```bash
cd widget
npm install
```

### 3. Install and Configure Ollama

Download Ollama from [ollama.com](https://ollama.com/download), then pull the required models:

```bash
ollama pull qwen2.5:7b           # Primary chat model (4.7 GB)
ollama pull qwen2.5-coder:7b    # Code model (optional, 4.4 GB)
ollama pull moondream            # Default vision model (1.7 GB)
```

Verify models are available:

```bash
ollama list
```

> **Note:** SADIE defaults to `qwen2.5:7b` for chat, `moondream` for vision, and `qwen2.5-coder:7b` for code. Models can be changed in Settings.

---

## Development Workflow

### Project Structure

```
Sadie/
├── widget/                     # Main Electron application
│   ├── src/
│   │   ├── main/               # Main process (Node.js)
│   │   │   ├── tools/          # 20+ TypeScript tool handlers
│   │   │   └── __tests__/      # 70+ main-process unit test suites
│   │   ├── renderer/           # React UI (Vite + HMR)
│   │   │   ├── components/     # React components
│   │   │   ├── styles/         # CSS (themes, animations)
│   │   │   ├── e2e/            # Playwright E2E specs
│   │   │   └── __tests__/      # 25+ renderer unit test suites
│   │   ├── preload/            # Context bridge (sandbox-safe IPC)
│   │   └── shared/             # Types, constants, utilities
│   ├── electron.vite.config.ts # Build configuration
│   ├── electron-builder.yml    # Installer packaging
│   ├── jest.config.ts          # Jest configuration
│   ├── playwright.config.ts    # E2E configuration
│   └── package.json
├── n8n-workflows/              # n8n workflow definitions
├── config/                     # JSON configuration files
├── scripts/                    # Build and utility scripts
├── prompts/                    # System prompts, intent detection
├── schemas/                    # JSON schemas for tool validation
├── docs/                       # Documentation
└── memory/                     # Local memory and RAG index
```

### Development Commands

```bash
cd widget

# Start with hot-reload (electron-vite dev server + Electron)
npm run dev

# Full production build (main + preload + renderer via electron-vite)
npm run build

# Create installable package (Windows NSIS installer)
npm run dist
```

> **Important:** SADIE uses **electron-vite** (not Webpack). The `npm run dev` command starts the Vite dev server for the renderer with HMR and builds the main process. The wrapper script also clears `ELECTRON_RUN_AS_NODE`, which VS Code terminals often inherit and which would otherwise make Electron start in Node-only mode. There are no separate `build:main` / `build:renderer` scripts — `npm run build` handles everything.

---

## Testing

### Unit Tests

SADIE maintains broad Jest and Playwright coverage across router, tools, renderer flows, and Electron E2E scenarios. See `TESTING_MATRIX.md` for the current inventory.

```bash
cd widget

# Run all unit tests
npx jest --config jest.config.ts --no-coverage

# Run with coverage report
npx jest --config jest.config.ts --coverage

# Run specific test file
npx jest --config jest.config.ts vision-tools --no-coverage

# Watch mode (re-runs on file changes)
npx jest --config jest.config.ts --watch
```

> **Important:** Always use `--config jest.config.ts` to avoid the multi-config error.

### E2E Tests

```bash
# Ensure Ollama is running first
ollama serve

# Run E2E tests
npm run e2e

# Debug E2E tests with Playwright UI
npx playwright test --ui

# Run in headed mode (see the browser)
npx playwright test --headed
```

### Test Prerequisites

- Ollama must be running for E2E tests.
- Set `SADIE_E2E=true` for test mode.
- E2E tests use an isolated `userData` directory for each run via `SADIE_E2E_USER_DATA_DIR` instead of Chromium CLI flags.

---

## Code Changes and Rebuilding

### Renderer Changes (React / CSS)

When modifying `src/renderer/` files:

- If `npm run dev` is running, **changes are applied automatically via HMR** — no rebuild needed.
- The Vite dev server at `localhost:5173` serves the renderer with hot module replacement.

### Main Process Changes

When modifying `src/main/` files:

- electron-vite rebuilds the main process automatically in dev mode.
- For a full rebuild: `npm run build` then `npm start`.

### Preload Script Changes

When modifying `src/preload/` files:

- Preload scripts require a full app restart: `npm run build` then `npm start`.

---

## Safe Development Practices

SADIE has three runtime modes. Always know which you are working in:

| Mode | When Used | Gating Variable |
|---|---|---|
| Development | Local coding | `NODE_ENV=development` |
| Test | Running tests | `SADIE_E2E=true` |
| Production | User releases | `NODE_ENV=production` |

### Rules

**1. Never commit test code to production paths**

```typescript
// CORRECT: Gated with environment check
if (process.env.SADIE_E2E === 'true') {
  // Test-only code here
}

// WRONG: Ungated test code
setupTestMocks(); // This will ship in production
```

**2. Gate diagnostic logs**

```typescript
// CORRECT: Release-gated logging
if (!isReleaseBuild) {
  console.log('[DIAG] Debug info');
}

// WRONG: Ungated debug logs
console.log('[DIAG] This ships to users');
```

**3. Use environment variables wisely**

```typescript
// CORRECT: Environment-aware features
const endpoint = isE2E ? 'http://localhost:3000' : productionUrl;

// WRONG: Hardcoded test values
const endpoint = 'http://localhost:3000';
```

**4. Test in all modes before committing**

```bash
npm run dev                                # Development mode
NODE_ENV=production npm run build          # Production build
npx jest --config jest.config.ts           # Unit tests
```

### Code Review Checklist

- [ ] No ungated test code
- [ ] No hardcoded localhost URLs in production paths
- [ ] Diagnostic logs are release-gated
- [ ] Environment variables properly handled
- [ ] New tools declare `requiredPermissions` in their tool definition
- [ ] TypeScript compiles cleanly: `npx tsc --noEmit`

---

## Debugging

### Application Does Not Start

```bash
npm run build        # Check for build errors
node --version       # Verify Node.js 18+
```

If `node_modules` is corrupted:

```bash
Remove-Item -Recurse node_modules, package-lock.json
npm install
```

### Ollama Connection Issues

```bash
curl http://127.0.0.1:11434/api/tags   # Verify Ollama is running
ollama list                             # Check model availability
ollama serve                            # Restart Ollama
```

### E2E Test Failures

```bash
npx playwright test --ui               # Debug with Playwright UI
npx playwright show-trace test-results/ # View test traces
npx playwright test --headed            # Run with visible browser
```

If Playwright or manual Electron launches die immediately with "bad option" or Node-only behavior, verify `ELECTRON_RUN_AS_NODE` is unset. The repo's `npm run dev` and `npm start` scripts already handle this.

### TypeScript Errors

```bash
npx tsc --noEmit     # Check for type errors not shown by VS Code
```

---

## Contributing

### Pull Request Process

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make changes following the safe development practices above.
4. Ensure all tests pass: `npx jest --config jest.config.ts --no-coverage`
5. Ensure TypeScript compiles cleanly: `npx tsc --noEmit`
6. Submit a pull request with a clear description.

### Code Standards

- **TypeScript** for type safety with strict mode enabled.
- **Jest** for unit testing; **Playwright** for E2E testing.
- **CSS classes** preferred over inline styles.
- **`requiredPermissions`** declared on tool definitions for permission-gated tools.

### Documentation Updates

When adding features, update the relevant documentation:

- `README.md` — Feature list and project overview.
- `TESTING_MATRIX.md` — New test suites.
- `CHANGELOG.md` — Version history.
- `docs/api-reference.md` — New IPC channels or tool schemas.
- `SECURITY_AND_COMPLIANCE.md` — Security-related changes.
