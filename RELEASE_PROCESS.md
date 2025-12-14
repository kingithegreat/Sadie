# SADIE Release Process

This document outlines the complete process for building, testing, and releasing SADIE in development, test, and production environments.

## Overview

SADIE uses a multi-stage release pipeline that ensures:
- Environment-specific builds
- Clean production artifacts
- Comprehensive testing
- Security hardening
- Artifact integrity validation

## Prerequisites

- Node.js 18+
- npm or yarn
- Ollama installed (for local AI models)
- Git

## Environment Modes

SADIE supports three runtime modes controlled by environment variables:

| Mode | NODE_ENV | Purpose | Features |
|------|----------|---------|----------|
| Development | `development` | Local development | Full logging, dev tools, test code included |
| Test | `test` | CI/testing | E2E enabled, diagnostics, test artifacts |
| Production | `production` | User deployment | Clean builds, security hardening, no test code |

## Build Commands

### Development Build
```bash
# Standard dev build
npm run build

# With dev server
npm run dev
```

### Test Build
```bash
# Run unit tests
npm test

# Run E2E tests
npm run e2e

# Full test suite
npm run test:all
```

### Production Build
```bash
# Full release process (recommended)
npm run release

# Manual steps (if needed)
NODE_ENV=production npm run build
NODE_ENV=production npm run package
```

## Preflight Script

The preflight script (`scripts/preflight-env-check.js`) runs automatically during `npm run release` and validates:

### Environment Checks
- Node.js version compatibility
- Required dependencies installed
- Ollama service availability
- Network connectivity for model downloads

### Security Validation
- Scans source code for forbidden strings (test code, debug flags)
- Validates environment variable sanitization
- Checks for accidental test artifact inclusion

### File System Checks
- Verifies build output directories
- Ensures clean working directory
- Validates package.json integrity

### Running Preflight Manually
```bash
node scripts/preflight-env-check.js
```

**Exit Codes:**
- `0`: All checks passed
- `1`: Environment issues found
- `2`: Security violations detected

## Artifact Scanner

The package integrity scanner (`scripts/scan-package-integrity.js`) validates packaged builds:

### What It Checks
- ASAR archive structure
- Forbidden file patterns (test files, debug logs)
- Environment variable leakage
- Code signing readiness (future)
- Bundle size limits

### Running Scanner Manually
```bash
node scripts/scan-package-integrity.js
```

**Validates:**
- No `*.test.js` files in packaged app
- No `[DIAG]` logs in release builds
- No development environment variables
- Clean ASAR contents

## Packaging Process

### Full Release Command
```bash
npm run release
```

This command executes:
1. Preflight environment check
2. Clean previous builds (`npm run clean`)
3. Production build (`NODE_ENV=production npm run build`)
4. Package application (`NODE_ENV=production npm run package`)
5. Integrity scan
6. Generate release artifacts

### Manual Packaging
```bash
# Build main process
NODE_ENV=production npm run build:main

# Build renderer
NODE_ENV=production npm run build:renderer

# Package with electron-builder
NODE_ENV=production npm run package
```

## Expected Outputs

### Development Mode
- `dist/` - Built application files
- `dist/main.js` - Main process bundle
- `dist/preload.js` - Preload script
- Full debug logging enabled

### Production Mode
- `release/` - Packaged installers
- `release/SADIE-*.exe` - Windows installer
- `release/SADIE-*.dmg` - macOS installer (if configured)
- `release/SADIE-*.AppImage` - Linux portable (if configured)
- `app.asar` - Packaged application archive
- Sanitized environment (no test code, no debug logs)

### Test Artifacts
- `test-results/` - Playwright traces and screenshots
- `coverage/` - Test coverage reports
- `playwright-report/` - E2E test reports

## Troubleshooting

### Common Release Failures

#### Preflight Fails: "Node version too old"
```
Error: Node.js 18+ required, found 16.14.0
```
**Solution:** Update Node.js to latest LTS version

#### Preflight Fails: "Ollama not running"
```
Error: Cannot connect to Ollama at http://localhost:11434
```
**Solution:** Start Ollama service and ensure models are downloaded

#### Build Fails: "Module not found"
```
Error: Cannot resolve 'electron'
```
**Solution:** Run `npm install` to restore dependencies

#### Packaging Fails: "asar integrity check failed"
```
Error: Found forbidden file: src/test/utils.test.js
```
**Solution:** Check `.gitignore` and ensure test files are excluded from build

#### E2E Tests Fail: "Modal not showing"
```
Error: First-run modal did not appear within 5000ms
```
**Solution:** Ensure `SADIE_E2E=true` is set and app is built in test mode

### Debug Commands

```bash
# Check environment
node -e "console.log(process.env)"

# Verify Ollama
curl http://localhost:11434/api/tags

# Clean and rebuild
npm run clean && npm run build

# Run with verbose logging
DEBUG=* npm run release
```

### Release Verification

After successful release:
1. Install packaged app in clean environment
2. Verify no console errors in production logs
3. Test basic functionality (chat, settings)
4. Check that E2E/test code is absent
5. Confirm runtime mode shows as "prod"

## CI/CD Integration

For automated releases, the process can be integrated into GitHub Actions:

```yaml
- name: Release
  run: npm run release
  env:
    NODE_ENV: production
```

## Version Management

- Versions are managed in `package.json`
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Tag releases: `git tag v1.0.0 && git push --tags`