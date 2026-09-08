#!/usr/bin/env node
// Development measurement only. Build widget/ first, then run from the repo root:
//   node scripts/measure-studio-baseline.cjs
// Three fresh profiles; real Electron/React with E2E service stubs. No media job.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const widget = path.join(root, 'widget');
const widgetRequire = createRequire(path.join(widget, 'package.json'));
const { _electron: electron } = widgetRequire('@playwright/test');
const entry = path.join(widget, 'out/main/index.js');
const output = path.join(widget, 'test-results', 'm0-baseline');

function builtFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Unexpected symlink in build output');
    return item.isDirectory() ? builtFiles(file) : [{ path: path.relative(widget, file), bytes: fs.statSync(file).size }];
  });
}

async function memorySnapshot(app) {
  // Electron MemoryInfo is in KB; a sum of working sets can double-count shared
  // pages. Preserve per-process values as well as the comparable aggregate.
  // https://www.electronjs.org/docs/latest/api/structures/memory-info
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
    type: metric.type,
    workingSetKB: metric.memory.workingSetSize,
    privateKB: metric.memory.privateBytes ?? null,
  })));
  if (!processes.some((p) => p.type === 'Browser') || processes.some((p) => !Number.isFinite(p.workingSetKB))) {
    throw new Error('Electron did not return usable process memory measurements');
  }
  return { processes, summedWorkingSetKB: processes.reduce((sum, p) => sum + p.workingSetKB, 0) };
}

async function measureRun(run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-m0-baseline-'));
  const env = { ...process.env, HOMEBOT_E2E: '1', NODE_ENV: 'test', HOMEBOT_E2E_USER_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const started = performance.now();
  let app;
  try {
    app = await electron.launch({ executablePath: widgetRequire('electron'), args: [entry], env });
    const page = await app.firstWindow();
    await page.locator('[data-testid="homebot-app-root"][data-hydrated="true"]').waitFor({ timeout: 45000 });
    const rendererReadyMs = Math.round(performance.now() - started);
    // A fresh profile MUST show onboarding. Failure is not silently skipped.
    await page.getByRole('button', { name: /Skip setup/i }).click();
    await page.locator('.first-run-overlay').waitFor({ state: 'detached' });
    const shell = await memorySnapshot(app);
    const studioStart = performance.now();
    await page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await page.getByRole('heading', { name: /Media Studio/ }).first().waitFor();
    const studioOpenMs = Math.round(performance.now() - studioStart);
    await page.getByText(/without your approval/i).waitFor();
    const studio = await memorySnapshot(app);
    await page.screenshot({ path: path.join(output, `studio-${run}.png`) });
    const versions = await app.evaluate(() => ({ ...process.versions }));
    return { run, rendererReadyMs, studioOpenMs, shell, studio, versions };
  } finally {
    if (app) await app.close();
    // Keep this disposable profile for diagnosis. Never touch the real profile.
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This baseline targets the supported Windows runtime');
  if (!fs.existsSync(entry)) throw new Error('Build widget/ before measuring; out/main/index.js is absent');
  fs.mkdirSync(output, { recursive: true });
  const files = builtFiles(path.join(widget, 'out'));
  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    scope: 'Fresh-profile Electron E2E shell and Studio UI; service stubs; no production/media/provider acceptance',
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    worktreeHasChanges: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    host: { platform: process.platform, release: os.release(), arch: process.arch, node: process.version, totalMemoryBytes: os.totalmem() },
    build: { totalBytes: files.reduce((sum, f) => sum + f.bytes, 0), studioChunks: files.filter((f) => /MediaStudioPanel-.*\.js$/.test(f.path)) },
    optionalPackageBytes: null,
    expensiveMediaJobPeakMemoryBytes: null,
    runs: [],
  };
  for (let run = 1; run <= 3; run++) {
    report.runs.push(await measureRun(run));
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Measured run ${run}: renderer ${report.runs.at(-1).rendererReadyMs}ms, Studio ${report.runs.at(-1).studioOpenMs}ms`);
  }
  console.log(`Baseline report: ${path.join(output, 'metrics.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
