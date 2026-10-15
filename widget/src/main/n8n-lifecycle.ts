/**
 * n8n-lifecycle.ts
 * Checks whether the n8n container is reachable on startup and attempts to
 * start it automatically via `docker start homebot-n8n` if it is not.
 *
 * This runs in the Electron main process. It is intentionally lightweight:
 * - No external npm deps (uses Node built-ins only)
 * - Never throws — failures are logged and surfaced via the returned status
 * - Skipped entirely in E2E test mode to avoid interfering with mock upstreams
 */

import { execFile } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

export type N8nStatus = 'already_running' | 'started' | 'start_failed' | 'timeout' | 'skipped';

const DEFAULT_N8N_URL = 'http://localhost:5678';
const CONTAINER_NAME = 'homebot-n8n';
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 45_000;

/** Resolves the absolute path to docker-compose.yml, searching from the app root upward. */
function findDockerCompose(): string | null {
  // app.getAppPath() → {project}/widget in dev, {install}/resources/app in prod
  // Walk up until we find docker-compose.yml (max 5 levels)
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'docker-compose.yml');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Returns true if the configured n8n instance responds. */
function checkN8nHealth(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(baseUrl, { timeout: 2000 }, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode < 500);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Polls n8n health until it's up or the timeout elapses. */
async function waitForN8n(baseUrl: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await checkN8nHealth(baseUrl)) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

/** Runs `docker start homebot-n8n` or `docker-compose up -d` as a fallback. */
function startContainer(composeFile: string | null): Promise<void> {
  return new Promise((resolve) => {
    // First try: start the named container directly (fastest, works if already created)
    execFile('docker', ['start', CONTAINER_NAME], { timeout: 15_000 }, (err) => {
      if (!err) { resolve(); return; }
      // Fallback: docker-compose up (creates the container if it has never been run)
      if (composeFile) {
        const composeDir = path.dirname(composeFile);
        execFile('docker', ['compose', '-f', composeFile, 'up', '-d'], { cwd: composeDir, timeout: 60_000 }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

/**
 * Ensures n8n is running.
 * - If already reachable: returns `'already_running'` immediately.
 * - If not reachable: attempts to start the Docker container, then polls until healthy.
 * - In E2E test mode: returns `'skipped'` immediately.
 *
 * @param baseUrl  Resolved n8n URL from Settings (or the environment override).
 * @param onStatusUpdate  Optional callback called when the status changes (e.g. to notify the renderer).
 */
export async function ensureN8nRunning(
  baseUrl = DEFAULT_N8N_URL,
  onStatusUpdate?: (status: 'checking' | 'starting' | N8nStatus) => void
): Promise<N8nStatus> {
  // Skip entirely in E2E tests so mock upstreams aren't disturbed
  if (process.env.HOMEBOT_E2E === '1' || process.env.HOMEBOT_E2E === 'true') {
    console.log('[n8n-lifecycle] E2E mode — skipping n8n startup check');
    return 'skipped';
  }

  onStatusUpdate?.('checking');
  console.log('[n8n-lifecycle] Checking n8n health...');

  if (await checkN8nHealth(baseUrl)) {
    console.log('[n8n-lifecycle] n8n already running ✓');
    onStatusUpdate?.('already_running');
    return 'already_running';
  }

  console.log('[n8n-lifecycle] n8n not reachable — attempting to start container...');
  onStatusUpdate?.('starting');

  const composeFile = findDockerCompose();
  if (composeFile) {
    console.log('[n8n-lifecycle] Found docker-compose.yml at:', composeFile);
  } else {
    console.warn('[n8n-lifecycle] docker-compose.yml not found — will try docker start only');
  }

  await startContainer(composeFile);
  console.log('[n8n-lifecycle] Container start command sent. Waiting for n8n to become healthy...');

  const healthy = await waitForN8n(baseUrl);
  const status: N8nStatus = healthy ? 'started' : 'timeout';
  console.log(`[n8n-lifecycle] Final status: ${status}`);
  onStatusUpdate?.(status);
  return status;
}
