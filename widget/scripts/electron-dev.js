#!/usr/bin/env node
// Launches electron-vite dev after stripping ELECTRON_RUN_AS_NODE from the
// environment. VS Code's integrated terminal sets this to "1", which forces
// Electron into Node-only mode — no Chromium init, no app module, no window.
delete process.env.ELECTRON_RUN_AS_NODE;

const { execSync } = require('child_process');
try {
  execSync('electron-vite dev', { stdio: 'inherit', env: process.env });
} catch (e) {
  process.exit(e.status ?? 1);
}
