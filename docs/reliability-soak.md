# Reliability: supervisor + soak test (Phase 0)

SADIE's startup checks were one-shot: diagnostics ran once, n8n was ensured
once, and nothing watched the services afterwards. Phase 0 adds a
**supervisor** that probes Ollama, n8n and Qdrant continuously for the whole
session, auto-recovers n8n via its Docker container when it dies mid-run, and
backs off with a circuit breaker instead of restart-looping. It starts with
the app and stops on quit — nothing to configure.

- Core: `src/supervisor/` (CI-gated, dependency-free, fully unit-tested)
- Electron adapter: `widget/src/main/supervisor-service.ts`
- State pushes to the renderer on `homebot:supervisor-status` (for the Phase 2
  trust UI); transitions also log with a `[supervisor]` prefix.
- Disabled automatically in E2E mode.

Per-service behaviour:

| Service | Probe | Auto-recovery |
|---|---|---|
| Ollama | HTTP GET, every 30 s | none (no safe cross-platform restart) — reported |
| n8n | HTTP GET, every 30 s | `docker start homebot-n8n` path, backoff 5 s → 5 min, breaker at 5 tries / 30 min |
| Qdrant | HTTP GET, every 30 s | none — optional dependency, reported |

## The 24-hour soak

The soak harness runs the same supervisor against the real local services for
a wall-clock duration, samples process memory and per-service health every
minute, and writes a pass/fail report.

**Run it (repo root, with Ollama + n8n running like a normal day):**

```bash
npm run soak -- --minutes 1440        # the real 24-hour soak
npm run soak                          # 2-minute smoke first, if you want
```

Leave the machine on. Console prints one line per sample; when it finishes it
prints a summary, writes `logs/soak-report-<timestamp>.json`, and exits **0 on
pass / 1 on fail**.

**Pass means:** Ollama and n8n each ended healthy with ≥ 95 % uptime **and
were each successfully probed at least once** (a run shorter than the 30 s
probe interval cannot pass — no observation, no verdict), RSS memory grew
≤ 35 % over the run, and the supervisor shut down with zero timers left. Mid-run n8n deaths are fine — that's the point; the report counts the
recoveries.

Optional mid-soak chaos test: `docker stop homebot-n8n` and watch the
supervisor bring it back within ~a minute.

Env overrides if your ports differ: `OLLAMA_URL`, `N8N_URL`, `QDRANT_URL`.
