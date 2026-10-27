# HomeBot Developer Build Guide

The single guide for installing, running, developing, building and releasing HomeBot. It absorbs the former `docs/setup-guide.md` (installation and first run) and `RELEASE_PROCESS.md` (release steps); those files now point here.

---

## Table of Contents

1. [One-Click Install (Recommended)](#one-click-install-recommended)
2. [Prerequisites](#prerequisites)
3. [Getting Started](#getting-started)
4. [Development Workflow](#development-workflow)
5. [Testing](#testing)
6. [Code Changes and Rebuilding](#code-changes-and-rebuilding)
7. [Safe Development Practices](#safe-development-practices)
8. [Debugging](#debugging)
9. [Updating HomeBot](#updating-homebot)
10. [File and Directory Reference](#file-and-directory-reference)
11. [Release Process](#release-process)
12. [Contributing](#contributing)

---

## One-Click Install (Recommended)

The simplest way to get HomeBot running:

1. **Download** `HomeBot-Setup.exe` from the latest release, or build it yourself:
   ```bash
   cd widget
   npm run dist    # Outputs to widget/dist-electron/
   ```
2. **Double-click** the installer. It installs to your user profile (no admin rights needed) and launches HomeBot automatically.
3. **Follow the setup wizard.** On first launch, HomeBot will:
   - Detect your GPU and set a hardware profile.
   - Download and install Ollama if it's not already on your machine.
   - Pull the essential AI models (`qwen2.5:7b` for chat, `nomic-embed-text` for embeddings) with a progress bar.
   - Drop you into the chat interface, ready to go.

That's it — no terminal, no manual model pulls, no Docker. Everything below is for developers who want to run from source.

---

## Prerequisites

### System Requirements

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | 18.0 or higher | Tested with v24.13.0 |
| **npm** | 9.0 or higher | Ships with Node.js |
| **Git** | Latest | Version control |
| **Ollama** | Latest | Local AI model hosting. Defaults: `qwen2.5:7b` (chat), `dolphin-mistral:7b` (uncensored), `moondream` (vision) |
| **Docker Desktop** | Latest | For n8n (optional) |
| **OS** | Windows 10+ (Windows 11 recommended) | Primary development platform |

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

### 2. Run the Automated Setup Script (optional)

```powershell
.\scripts\setup\Setup-HomeBot.ps1
```

This script will:

1. Verify that Node.js, npm, Docker, and Ollama are installed and meet minimum versions.
2. Create any missing configuration files (`config/api-allowlist.json`, `config/default-config.json`).
3. Run `npm install` inside `widget/` if `node_modules` is absent.
4. Pull the baseline Ollama models (`qwen2.5:7b`, `qwen2.5-coder:7b`, `moondream`, `nomic-embed-text`) for first-run compatibility.
5. Print a checklist summary with instructions for anything requiring manual attention.

> **Note:** Re-running the script is safe. It will not overwrite existing config files or re-pull models that are already installed.

To skip the model pull step (for example, on a CI machine):

```powershell
.\scripts\setup\Setup-HomeBot.ps1 -SkipModelPull
```

### 3. Install Dependencies

```bash
cd widget
npm install
```

### 4. Install and Configure Ollama

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

> **Note:** HomeBot defaults to `qwen2.5:7b` for chat, `moondream` for vision, and `qwen2.5-coder:7b` for code. Models can be changed in Settings.

#### Starting Ollama

```bash
ollama serve
```

Ollama must be running before you start HomeBot. If it is already running as a background service (the default after installation), you can skip this step.

Verify it is reachable:

```bash
ollama list
# Or check the API endpoint directly:
curl http://127.0.0.1:11434/api/tags
```

#### Recommended Models

```bash
ollama pull qwen2.5:7b           # Primary chat model (4.7 GB)
ollama pull dolphin-mistral:7b   # Uncensored mode model (4.1 GB)
ollama pull moondream            # Default vision model (1.7 GB)
ollama pull nomic-embed-text     # Embeddings for RAG and memory enrichment
ollama pull gemma4:e4b           # 16 GB+ GPU recommended (9.6 GB, optional)
```

### 5. Start n8n (Optional)

n8n provides optional workflow orchestration for scheduled tasks and external integrations. HomeBot's core functionality (all 85+ tool handlers) works without n8n.

```bash
docker compose up -d
```

This starts n8n at `http://localhost:5678` using the credentials in `docker-compose.yml`.

> **First time only:** Open `http://localhost:5678`, complete the n8n onboarding, then import the workflows from `n8n-workflows/core/` via **n8n > Workflows > Import from File**.

### 6. Launch HomeBot

```bash
cd widget
npm run dev      # hot-reload dev server (see Development Workflow)
```

From the repo root on Windows you can also use the launcher:

```powershell
powershell -ExecutionPolicy Bypass -File start.ps1        # quick start (npm start in widget/)
powershell -ExecutionPolicy Bypass -File start.ps1 -Full  # dependency checks (Node, npm, Docker/Qdrant, Ollama, deps, internet) first
```

or double-click `start.bat` (passes its arguments through to `start.ps1`).

### 7. First-Run Onboarding

When HomeBot opens for the first time, a setup wizard guides you through configuration:

1. **Welcome screen** — Choose between **Local (Ollama)** for fully offline AI or **Cloud API** for hosted inference (GPT-4o, Claude, Gemini, and free-tier providers).
2. **Local path** — The wizard automatically:
   - Detects your GPU and VRAM to set a hardware profile.
   - Checks if Ollama is installed. If not, offers a one-click "Install Ollama automatically" button that downloads and installs it silently.
   - Starts Ollama if it's installed but not running.
   - Pulls essential models (`qwen2.5:7b`, `nomic-embed-text`) with real-time progress bars.
   - Shows "Ollama is ready!" when everything is set up.
3. **Cloud path** — Pick a provider, paste an API key, and test the connection. Free-tier providers are marked.
4. **Done** — Click **Get Started** to enter the chat interface. Telemetry consent is handled automatically (local-only, no remote data).
5. **Global hotkey** — Defaults to `Ctrl+Shift+Space` (Windows). Changeable in **Settings > Widget Hotkey**.
6. **n8n URL** — Defaults to `http://localhost:5678`. Update in **Settings > n8n URL** if you changed the docker-compose port.

### 8. Verify Tools Are Working

Open the widget (`Ctrl+Shift+Space`) and try a few commands:

```
List the files in my Downloads folder
What time is it?
Search for "readme" files on my Desktop
What are the current NBA standings?
```

To see all available tools, open **Settings > View Tools** or ask:

```
What tools do you have?
```

#### Try the Other Modes

HomeBot has six modes, accessible from the sidebar or via keyboard shortcuts:

| Mode | Shortcut | What to Try |
|---|---|---|
| **Chat** | Ctrl+1 | Ask a question, run a tool, attach a document |
| **Automation** | Ctrl+2 | Create a "Morning News Summary" automation and click ▶ Run. Use 🔑 Credentials to manage n8n API keys. |
| **Image** | Ctrl+3 | Type a prompt to generate an image (auto-detects local engines: stable-diffusion.cpp, SD WebUI, ComfyUI; then Pollinations or Stable Horde; OpenAI GPT Image if a key is set) |
| **Documents** | Ctrl+4 | Open a file, then use **Add to RAG** to index it for semantic search or **Send to Chat** to discuss it with HomeBot |
| **Quiz** | Ctrl+5 | Pick a coding topic (Python, JS, etc.), difficulty, and take a quiz |

---

## Development Workflow

### Project Structure

```
HomeBot/
├── widget/                     # Main Electron application
│   ├── src/
│   │   ├── main/               # Main process (Node.js)
│   │   │   ├── tools/          # 85+ TypeScript tool handlers
│   │   │   └── __tests__/      # Main-process unit test suites
│   │   ├── renderer/           # React UI (Vite + HMR)
│   │   │   ├── components/     # React components
│   │   │   ├── styles/         # CSS (themes, animations)
│   │   │   ├── e2e/            # Playwright E2E specs
│   │   │   └── __tests__/      # Renderer unit test suites
│   │   ├── preload/            # Context bridge (sandbox-safe IPC)
│   │   └── shared/             # Types, constants, utilities
│   ├── electron.vite.config.ts # Build configuration
│   ├── jest.config.ts          # Jest configuration
│   ├── playwright.config.ts    # E2E configuration
│   └── package.json            # Scripts; its "build" field is the electron-builder config `npm run dist` reads
├── n8n-workflows/              # n8n workflow definitions
├── config/                     # JSON configuration files
├── scripts/                    # Build and utility scripts
├── prompts/                    # System prompts, intent detection
├── schemas/                    # JSON schemas for tool validation
├── docs/                       # Documentation
├── memory/                     # Local memory and RAG index
├── electron-builder.yml        # Root electron-builder config (repo root, not widget/)
├── docker-compose.yml          # n8n container configuration
└── start.bat, start.ps1        # Windows launchers (start.ps1 -Full runs dependency checks)
```

### Development Commands

```bash
cd widget

# Start with hot-reload (electron-vite dev server + Electron)
npm run dev

# Full production build (main + preload + renderer via electron-vite)
npm run build

# Create installable package (Windows NSIS installer, output in widget/dist-electron/)
npm run dist
```

> **Important:** HomeBot uses **electron-vite** (not Webpack). The `npm run dev` command starts the Vite dev server for the renderer with HMR and builds the main process. The wrapper script also clears `ELECTRON_RUN_AS_NODE`, which VS Code terminals often inherit and which would otherwise make Electron start in Node-only mode. There are no separate `build:main` / `build:renderer` scripts — `npm run build` handles everything.

---

## Testing

### Unit Tests

HomeBot maintains broad Jest and Playwright coverage across router, tools, renderer flows, and Electron E2E scenarios.

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
- Set `HOMEBOT_E2E=true` for test mode.
- E2E tests use an isolated `userData` directory for each run via `HOMEBOT_E2E_USER_DATA_DIR` instead of Chromium CLI flags.

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

HomeBot has three runtime modes. Always know which you are working in:

| Mode | When Used | Gating Variable |
|---|---|---|
| Development | Local coding | `NODE_ENV=development` |
| Test | Running tests | `HOMEBOT_E2E=true` |
| Production | User releases | `NODE_ENV=production` |

### Rules

**1. Never commit test code to production paths**

```typescript
// CORRECT: Gated with environment check
if (process.env.HOMEBOT_E2E === 'true') {
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

### Ollama Not Found / Models Not Loading

- Confirm `ollama serve` is running.
- Run `ollama list` to see installed models.
- Manually pull a model: `ollama pull qwen2.5:7b`
- HomeBot includes an Ollama heartbeat that auto-restarts Ollama if it goes down. Check the status indicator in the UI.
- Verify the API is reachable: `curl http://127.0.0.1:11434/api/tags`

### Widget Does Not Start / Blank Screen

- Check the DevTools console (`Ctrl+Shift+I` in the widget window).
- Confirm `node_modules` exists: `ls widget/node_modules`. If not, run `npm install` inside `widget/`.
- Check `widget/logs/` for error logs written during startup.
- Try a clean rebuild: `npm run build` then `npm start`.
- If Electron behaves like a plain Node.js process in an integrated terminal, use `npm run dev` or clear `ELECTRON_RUN_AS_NODE` before launching manually.

### n8n Unavailable

- Confirm Docker is running: `docker ps`
- Check n8n logs: `docker compose logs n8n`
- Ensure the n8n URL in Settings matches the port in `docker-compose.yml`.

### Tool Execution Denied

- Check `config/safety-rules.json` — it defines path and operation whitelists.
- Check `config/tool-allowlist.json` — confirms which tools are enabled.
- Some tools (file deletion, process kill) require explicit user confirmation in the UI.

### Custom API Hosts Blocked

Add the hostname to `config/api-allowlist.json`:

```json
["api.myservice.com", "internal.company.net"]
```

Restart the widget after editing (the list is read at startup).

### Speech Recognition Not Working

- Windows SAPI is used for offline speech recognition. Ensure it is available on your system.
- Check that no other application has exclusive access to the microphone.

---

## Updating HomeBot

```bash
git pull origin main
cd widget
npm install        # In case new dependencies were added
npm run dev
```

Or re-run the setup script:

```powershell
.\scripts\setup\Setup-HomeBot.ps1 -SkipModelPull
```

---

## File and Directory Reference

| Path | Purpose |
|---|---|
| `widget/` | Electron + React application source code |
| `widget/src/main/` | Main process (message-router, tools, IPC handlers) |
| `widget/src/renderer/` | React UI (components, styles, e2e tests) |
| `widget/src/preload/` | Context bridge (sandbox-safe IPC) |
| `widget/src/shared/` | Shared types, constants, and utilities |
| `config/` | Runtime configuration files |
| `config/default-config.json` | Core settings (models, URLs, hotkey, permissions) |
| `config/api-allowlist.json` | Approved API hostnames for the `api_request` tool |
| `config/safety-rules.json` | Path and operation whitelist for file and system tools |
| `config/tool-allowlist.json` | Enabled/disabled state for each tool |
| `n8n-workflows/core/` | n8n workflow definitions (orchestrator, safety validator) |
| `n8n-workflows/tools/` | n8n image generation workflow |
| `memory/json-store/` | Persistent key-value memory store |
| `memory/rag-index.json` | RAG document index |
| `logs/` | Runtime log files |
| `scripts/` | Setup, build, and utility scripts |
| `scripts/setup/Setup-HomeBot.ps1` | Automated setup and preflight script |
| `prompts/` | System prompts and intent detection templates |
| `schemas/` | JSON schemas for tool call validation |
| `docs/` | Developer and API documentation |

---

## Release Process

Step-by-step process for building, validating, and publishing a HomeBot release.

---

### Version Numbering

HomeBot uses semantic versioning: `MAJOR.MINOR.PATCH`

| Component | When to Increment |
|---|---|
| **MAJOR** | Breaking changes to IPC API or tool contracts |
| **MINOR** | New features, new tools, significant UI additions |
| **PATCH** | Bug fixes, security patches, documentation updates |

Current version is maintained in `widget/package.json`.

---

### Pre-Release Checklist

#### 1. Code Quality

```bash
cd widget

# TypeScript compilation (must be clean)
npx tsc --noEmit

# All unit tests (must be 0 failures)
npx jest --config jest.config.ts --no-coverage

# E2E tests (Ollama must be running)
npm run e2e
```

**Expected**: 181 suites, ~2,780 tests, 0 failures. _(Verified 2026-08-13. The previous figure — 120 suites / 1,872 tests — was ~900 tests stale, so the gate could not actually be failed by anyone reading it.)_

> The suite runs in ~45s but does not release the process afterwards, so add `--forceExit` when scripting it. Two causes were found and fixed; at least one handle remains, isolated to `src/main` and not attributable by `--detectOpenHandles`. Every test passes — the flag is about teardown, not failures.

#### 2. Security Validation

```bash
# Dependency audit. Expected: 6 (2 moderate, 4 high) — every one of them is a
# RECORDED, ACCEPTED decision. See SECURITY-AUDIT.md before changing anything,
# and never run `npm audit fix --force`: it would downgrade exceljs a major
# version to silence an advisory that cannot fire in this codebase.
npm audit

# Package integrity scan
node ../scripts/scan-package-integrity.js

# Preflight environment check
node ../scripts/preflight-env-check.js
```

#### 3. Documentation Review

Verify the following files are up to date:

- [ ] `CHANGELOG.md` — New version entry with all changes
- [ ] `README.md` — Feature list and test counts
- [ ] `DEVELOPER_BUILD_GUIDE.md` — Installation, first-run and build instructions

#### 4. Version Bump

Update the version in `widget/package.json`:

```json
{
  "version": "X.Y.Z"
}
```

---

### Build Process

#### Development Build

```bash
cd widget
npm run build
```

This runs `electron-vite build`, which compiles:
- **Main process** → `out/main/`
- **Preload script** → `out/preload/`
- **Renderer** → `out/renderer/`

#### Production Installer

```bash
cd widget
npm run dist
```

This runs `npm run build:release` and then `electron-builder` from `widget/`, which reads the `build` field of `widget/package.json`, producing:

| Artifact | Location | Format |
|---|---|---|
| **NSIS Installer** | `widget/dist-electron/` | `.exe` (Windows) |
| **Unpacked** | `widget/dist-electron/win-unpacked/` | Directory |
| **Update files** | `widget/dist-electron/` | `.yml`, `.blockmap` |

#### Build Configuration

- **`widget/package.json` `build` field** — Installer settings used by `npm run dist` (app name, icon, NSIS config, extra resources, asar unpack). A root `electron-builder.yml` also exists; keep it in step if you change packaging.
- **`widget/electron.vite.config.ts`** — Build settings (entry points, aliases, plugins)

---

### Release Steps

#### 1. Final Validation

```bash
cd widget

# Clean build
Remove-Item -Recurse -Force out, dist-electron -ErrorAction SilentlyContinue
npm run build

# Run from build output
npm start

# Verify the app launches and basic chat works
```

#### 2. Create Installer

```bash
npm run dist
```

#### 3. Test Installer

1. Run the NSIS installer from `widget/dist-electron/`.
2. Verify installation completes without errors.
3. Launch the installed application.
4. Verify Ollama connection.
5. Send a test chat message.
6. Verify tools work (e.g., file read).
7. Verify settings persist after restart.

#### 4. Git Tag

```bash
git add -A
git commit -m "v<X.Y.Z> — <summary>"
git tag -a v<X.Y.Z> -m "v<X.Y.Z> — <summary>"
git push origin main
git push origin v<X.Y.Z>
```

#### 5. GitHub Release

1. Go to [Releases](https://github.com/kingithegreat/Sadie/releases).
2. Click **Draft a new release**.
3. Select the tag `v<X.Y.Z>`.
4. Title: `v<X.Y.Z> — <summary>`.
5. Body: Copy the relevant CHANGELOG.md entry.
6. Attach the installer `.exe` from `widget/dist-electron/`.
7. Publish the release.

---

### Auto-Update

HomeBot uses Electron's built-in auto-update mechanism:

- The app checks for updates on launch.
- Update metadata is fetched from the GitHub Releases API.
- Downloads are verified with signature checks.
- Users are prompted to install updates.

The repository field is already configured in [widget/package.json](widget/package.json). The remaining operational step is publishing a GitHub Release with the packaged installer artifacts so update metadata exists for clients to consume.

---

### Rollback

If a release has critical issues:

1. **Immediate**: Remove the GitHub Release (hides the download).
2. **Hotfix**: Create a patch release with the fix.
3. **Tag cleanup** (if needed): `git tag -d v<X.Y.Z> && git push origin :refs/tags/v<X.Y.Z>`

---

### Post-Release

After a successful release:

1. Update `CHANGELOG.md` to add a new `## [Unreleased]` section.
2. Monitor GitHub Issues for user reports.
3. Verify auto-update works by checking the previous version detects the new release.

---

### Troubleshooting

#### Build Fails

| Symptom | Fix |
|---|---|
| TypeScript errors | Run `npx tsc --noEmit` and fix reported issues |
| Missing modules | `Remove-Item -Recurse node_modules; npm install` |
| electron-builder errors | Check the `build` field in `widget/package.json` for syntax issues |
| Vite build errors | Check `widget/electron.vite.config.ts` for plugin issues |

#### Installer Issues

| Symptom | Fix |
|---|---|
| NSIS compilation fails | Verify the `nsis` section of the `build` field in `widget/package.json` |
| Installer too large | Check for unnecessary files in `files` config |
| App won't launch after install | Check main process entry point in package.json |

#### Test Failures Before Release

- Never release with failing tests.
- Run tests in isolation to identify flaky tests: `npx jest --config jest.config.ts --runInBand`
- Check for environment-dependent failures (timezone, locale).

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
- `docs/api-reference.md` — New IPC channels or tool schemas.
- `DEVELOPER_BUILD_GUIDE.md` — Installation, first-run, build and release instructions.
