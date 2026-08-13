# HomeBot — Release Process

Step-by-step process for building, validating, and publishing a HomeBot release.

---

## Version Numbering

HomeBot uses semantic versioning: `MAJOR.MINOR.PATCH`

| Component | When to Increment |
|---|---|
| **MAJOR** | Breaking changes to IPC API or tool contracts |
| **MINOR** | New features, new tools, significant UI additions |
| **PATCH** | Bug fixes, security patches, documentation updates |

Current version is maintained in `widget/package.json`.

---

## Pre-Release Checklist

### 1. Code Quality

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

### 2. Security Validation

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

### 3. Documentation Review

Verify the following files are up to date:

- [ ] `CHANGELOG.md` — New version entry with all changes
- [ ] `README.md` — Feature list and test counts
- [ ] `docs/setup-guide.md` — Installation and first-run instructions

### 4. Version Bump

Update the version in `widget/package.json`:

```json
{
  "version": "X.Y.Z"
}
```

---

## Build Process

### Development Build

```bash
cd widget
npm run build
```

This runs `electron-vite build`, which compiles:
- **Main process** → `out/main/`
- **Preload script** → `out/preload/`
- **Renderer** → `out/renderer/`

### Production Installer

```bash
cd widget
npm run dist
```

This runs `electron-builder` with the configuration in `electron-builder.yml`, producing:

| Artifact | Location | Format |
|---|---|---|
| **NSIS Installer** | `widget/dist/` | `.exe` (Windows) |
| **Unpacked** | `widget/dist/win-unpacked/` | Directory |
| **Update files** | `widget/dist/` | `.yml`, `.blockmap` |

### Build Configuration

- **electron-builder.yml** — Installer settings (app name, icon, NSIS config)
- **electron.vite.config.ts** — Build settings (entry points, aliases, plugins)

---

## Release Steps

### 1. Final Validation

```bash
cd widget

# Clean build
Remove-Item -Recurse -Force out, dist -ErrorAction SilentlyContinue
npm run build

# Run from build output
npm start

# Verify the app launches and basic chat works
```

### 2. Create Installer

```bash
npm run dist
```

### 3. Test Installer

1. Run the NSIS installer from `widget/dist/`.
2. Verify installation completes without errors.
3. Launch the installed application.
4. Verify Ollama connection.
5. Send a test chat message.
6. Verify tools work (e.g., file read).
7. Verify settings persist after restart.

### 4. Git Tag

```bash
git add -A
git commit -m "v<X.Y.Z> — <summary>"
git tag -a v<X.Y.Z> -m "v<X.Y.Z> — <summary>"
git push origin main
git push origin v<X.Y.Z>
```

### 5. GitHub Release

1. Go to [Releases](https://github.com/kingithegreat/Sadie/releases).
2. Click **Draft a new release**.
3. Select the tag `v<X.Y.Z>`.
4. Title: `v<X.Y.Z> — <summary>`.
5. Body: Copy the relevant CHANGELOG.md entry.
6. Attach the installer `.exe` from `widget/dist/`.
7. Publish the release.

---

## Auto-Update

HomeBot uses Electron's built-in auto-update mechanism:

- The app checks for updates on launch.
- Update metadata is fetched from the GitHub Releases API.
- Downloads are verified with signature checks.
- Users are prompted to install updates.

The repository field is already configured in [widget/package.json](widget/package.json). The remaining operational step is publishing a GitHub Release with the packaged installer artifacts so update metadata exists for clients to consume.

---

## Rollback

If a release has critical issues:

1. **Immediate**: Remove the GitHub Release (hides the download).
2. **Hotfix**: Create a patch release with the fix.
3. **Tag cleanup** (if needed): `git tag -d v<X.Y.Z> && git push origin :refs/tags/v<X.Y.Z>`

---

## Post-Release

After a successful release:

1. Update `CHANGELOG.md` to add a new `## [Unreleased]` section.
2. Monitor GitHub Issues for user reports.
3. Verify auto-update works by checking the previous version detects the new release.

---

## Troubleshooting

### Build Fails

| Symptom | Fix |
|---|---|
| TypeScript errors | Run `npx tsc --noEmit` and fix reported issues |
| Missing modules | `Remove-Item -Recurse node_modules; npm install` |
| electron-builder errors | Check `electron-builder.yml` for syntax issues |
| Vite build errors | Check `electron.vite.config.ts` for plugin issues |

### Installer Issues

| Symptom | Fix |
|---|---|
| NSIS compilation fails | Verify electron-builder.yml `nsis` section |
| Installer too large | Check for unnecessary files in `files` config |
| App won't launch after install | Check main process entry point in package.json |

### Test Failures Before Release

- Never release with failing tests.
- Run tests in isolation to identify flaky tests: `npx jest --config jest.config.ts --runInBand`
- Check for environment-dependent failures (timezone, locale).
