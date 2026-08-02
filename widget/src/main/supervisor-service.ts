/**
 * supervisor-service.ts (Phase 0 — reliability)
 *
 * Thin Electron adapter over the supervisor core (root src/supervisor) —
 * same placement pattern as the CRM (core in root src so the required CI
 * gate protects it; adapter here).
 *
 * Watches the app's external services continuously *after* startup — the gap
 * diagnostics (one-shot) and n8n-lifecycle (startup-only) leave open:
 *   - ollama  → probe only (no safe cross-platform auto-restart)
 *   - n8n     → probe + auto-recovery via the existing container-start path
 *   - qdrant  → probe only (optional dependency)
 *
 * State changes are logged and pushed to the renderer on
 * 'homebot:supervisor-status' (same one-way pattern as 'homebot:n8n-status').
 * Skipped entirely in E2E mode so mock upstreams are never probed or
 * "recovered".
 */

import { BrowserWindow } from 'electron';
import * as http from 'http';
import { Supervisor } from '../../../src/supervisor/supervisor';
import { ServiceSpec, SupervisorStatus } from '../../../src/supervisor/types';
import { isE2E } from './env';
import { ensureN8nRunning } from './n8n-lifecycle';

export interface SupervisorServiceHandle {
  stop: () => void;
  getStatus: () => SupervisorStatus | null;
}

/** GET the URL; healthy = any HTTP response < 500 within timeoutMs. */
function httpProbe(url: string, timeoutMs = 3_000): () => Promise<boolean> {
  return () =>
    new Promise<boolean>((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode < 500);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
}

/**
 * Starts continuous service supervision. Call once after app ready.
 * Returns a handle with stop() (wire into before-quit) and getStatus().
 */
export function startSupervisorService(opts: {
  ollamaUrl: string;
  n8nUrl: string;
  qdrantUrl?: string;
  getWindow: () => BrowserWindow | null;
}): SupervisorServiceHandle {
  // E2E runs use mock upstreams — never probe or auto-recover against them.
  if (isE2E) {
    console.log('[supervisor] E2E mode — supervision disabled');
    return { stop: () => undefined, getStatus: () => null };
  }

  const qdrantUrl = opts.qdrantUrl || 'http://localhost:6333';
  const services: ServiceSpec[] = [
    {
      name: 'ollama',
      required: true,
      probe: httpProbe(opts.ollamaUrl.replace(/\/$/, '')),
    },
    {
      name: 'n8n',
      required: true,
      probe: httpProbe(opts.n8nUrl.replace(/\/$/, '')),
      // ensureN8nRunning already health-checks first, starts the container if
      // needed, and polls up to 45s — so the 60s recovery timeout covers it.
      recover: async () => {
        await ensureN8nRunning();
      },
    },
    {
      name: 'qdrant',
      required: false,
      probe: httpProbe(qdrantUrl.replace(/\/$/, '')),
    },
  ];

  const supervisor = new Supervisor(services);
  supervisor.onEvent((e) => {
    if (e.type === 'state-change') {
      console.log(`[supervisor] ${e.service}: ${e.from} → ${e.to} (${e.detail ?? ''})`);
      try {
        const win = opts.getWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('homebot:supervisor-status', {
            service: e.service,
            from: e.from,
            to: e.to,
            at: e.at,
          });
        }
      } catch {
        /* renderer push is best-effort */
      }
    } else if (e.type === 'recovery-attempt' || e.type === 'breaker-open' || e.type === 'recovery-error') {
      console.log(`[supervisor] ${e.service}: ${e.type} (${e.detail ?? ''})`);
    }
  });
  supervisor.start();
  console.log('[supervisor] started — watching ollama, n8n, qdrant');

  return {
    stop: () => supervisor.stop(),
    getStatus: () => supervisor.getStatus(),
  };
}
