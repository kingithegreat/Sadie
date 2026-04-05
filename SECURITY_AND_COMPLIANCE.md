# SADIE — Security and Compliance

Detailed documentation of SADIE's security architecture, threat mitigations, and compliance posture.

---

## Security Philosophy

SADIE follows a **defence-in-depth** strategy. No single security control is considered sufficient — multiple independent layers ensure that a bypass at one level is caught by another. All security measures are active by default and cannot be disabled by the user.

---

## Architecture-Level Security

### Process Isolation (Electron)

| Control | Implementation |
|---|---|
| **Sandbox** | `sandbox: true` on all BrowserWindow instances |
| **Context Isolation** | `contextIsolation: true` — renderer has no access to Node.js |
| **Node Integration** | `nodeIntegration: false` — renderer cannot require() modules |
| **Preload Script** | `contextBridge.exposeInMainWorld` exposes only typed, validated API |

The renderer process runs in a Chromium sandbox with no direct access to the filesystem, network, or operating system. All operations must go through the preload bridge, which validates every call.

### Content Security Policy (CSP)

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' http://localhost:11434 https://*.openai.com https://*.anthropic.com;
```

CSP headers are set on every renderer page to prevent XSS, inline script injection, and unauthorized external connections.

### IPC Allowlist

The preload script maintains a strict allowlist of permitted IPC channels. Any `ipcRenderer.invoke()` or `ipcRenderer.send()` call to a channel not in the allowlist is silently blocked. This prevents a compromised renderer from accessing arbitrary main-process functionality.

---

## 7-Layer Safety Pipeline

Every user message and tool result passes through seven sequential safety filters before reaching the LLM or being displayed:

### Layer 1 — Profanity / Toxicity Filter

- Blocks messages containing hate speech, slurs, or toxic language.
- Uses keyword matching with contextual awareness.
- Blocked messages are logged but not forwarded.

### Layer 2 — Harm Detection

- Detects self-harm, violence, and dangerous instruction content.
- Pattern-based detection with configurable sensitivity.
- Triggers a safe response redirect.

### Layer 3 — PII Redaction

- Strips personally identifiable information (email, phone, SSN patterns).
- Regex-based detection with locale awareness.
- Redacted content is replaced with `[REDACTED]`.

### Layer 4 — Prompt Injection Guard

- Detects jailbreak attempts, role-play overrides, and system prompt extraction.
- Pattern matching for known injection techniques.
- Blocked attempts are logged to the audit trail.

### Layer 5 — Tool-Abuse Prevention

- **Recursion cap**: Tool calls are limited to prevent infinite loops (max depth enforced).
- **Rate limiting**: Excessive tool calls within a time window are throttled.
- **Permission preflight**: Batch tool operations check permissions atomically before execution.

### Layer 6 — Output Sanitisation

- LLM responses are sanitised before rendering.
- HTML tags are stripped or escaped.
- Script injection in Markdown code blocks is neutralised.
- Toast notification XML is sanitised to prevent CVE-style injection.

### Layer 7 — Audit Logging

- All user messages, tool calls, permission decisions, and safety filter triggers are logged.
- Logs are stored locally in `execution.log.jsonl`.
- Log buffer is capped to prevent unbounded disk usage.

---

## Tool-Specific Security

### File System Operations

| Threat | Mitigation |
|---|---|
| **Path traversal** | Paths are normalised and validated against allowed directories |
| **Symlink attacks** | Symlinks are resolved before access checks |
| **Sensitive file access** | Patterns like `.env`, `.ssh`, `passwd` are blocked |

### Network Requests (API Tool)

| Threat | Mitigation |
|---|---|
| **SSRF** | Internal network addresses (127.0.0.1, 10.x, 172.16–31.x, 192.168.x, ::1) are blocked |
| **DNS rebinding** | Resolved IP is checked after DNS resolution |
| **Allowlist** | Only domains in `config/api-allowlist.json` are permitted |
| **Timeout** | All HTTP requests have enforced timeouts |

### Git Operations

| Threat | Mitigation |
|---|---|
| **Command injection** | Git arguments are passed as arrays, not shell strings |
| **Message injection** | Commit messages are sanitised (newlines, special chars stripped) |

### Process Management

| Threat | Mitigation |
|---|---|
| **PID injection** | Process IDs are validated as positive integers before kill |
| **Privilege escalation** | Only user-owned processes can be managed |

### Notification System

| Threat | Mitigation |
|---|---|
| **Toast XML injection** | All notification content is XML-escaped before Windows toast API |

### Image Generation

| Threat | Mitigation |
|---|---|
| **Prompt injection** | Image prompts are sanitised before API call |
| **Fallback chain** | Pollinations → Stable Horde fallback prevents single-provider dependency |

### Browser Content Extraction

| Threat | Mitigation |
|---|---|
| **URL validation** | Only HTTP/HTTPS URLs are accepted |
| **Content limits** | Extracted content is truncated to prevent memory exhaustion |

---

## Permission Model

### Permission Escalation Flow

```
Tool requires permission
        │
        ▼
┌─────────────────────┐
│  Permission already  │──► Yes ──► Execute tool
│  granted?            │
└───────┬─────────────┘
        │ No
        ▼
┌─────────────────────┐
│  Show Permission     │
│  Modal to user       │
│                      │
│  [Allow Once]        │──► Execute once, don't persist
│  [Always Allow]      │──► Execute and persist for this tool
│  [Deny]              │──► Block execution, inform user
└─────────────────────┘
```

### Permission Categories

| Category | Tools | Risk Level |
|---|---|---|
| **Read** | File read, web search, sports data | Low |
| **Write** | File create, file write, clipboard write | Medium |
| **Execute** | Code runner, process manager | High |
| **Network** | API requests, browser content | Medium |
| **System** | System info, notification | Low |

### Permission Persistence

- **Allow Once**: Permission is granted for the current request only.
- **Always Allow**: Permission is persisted in the user's config for the specific tool.
- **Deny**: The tool execution is blocked and the user is informed.
- Persisted permissions can be revoked at any time via Settings.

---

## Webhook Security (n8n Integration)

| Control | Implementation |
|---|---|
| **HMAC Authentication** | All webhook calls include HMAC-SHA256 signature |
| **Secret Rotation** | Webhook secrets can be rotated without downtime |
| **Payload Validation** | Webhook payloads are validated against JSON schemas |
| **Rate Limiting** | Webhook endpoints enforce rate limits |

---

## API Key Management

- Cloud LLM API keys are stored in Electron's encrypted `userData` directory.
- Keys are never written to log files.
- Keys are never included in error messages or telemetry.
- Keys are only sent to the configured provider's API endpoint (validated by URL).

---

## Telemetry and Privacy

| Principle | Implementation |
|---|---|
| **Opt-in only** | Telemetry requires explicit user consent via modal |
| **Local storage** | All analytics data is stored locally, never sent externally |
| **No PII** | Telemetry events contain no personally identifiable information |
| **Revocable** | Consent can be withdrawn at any time via Settings |

---

## Dependency Security

### Package Integrity

- `scripts/scan-package-integrity.js` audits `node_modules` for known vulnerabilities.
- `npm audit` is run as part of the preflight check before releases.
- Dependencies are pinned in `package-lock.json` for reproducible builds.

### Build Security

- electron-builder uses code signing for release builds.
- NSIS installer includes file integrity checks.
- Auto-update uses Electron's built-in updater with signature verification.

---

## Compliance Summary

| Standard | Status | Notes |
|---|---|---|
| **OWASP Top 10** | Addressed | SSRF, XSS, injection all mitigated |
| **Electron Security Best Practices** | Compliant | Sandbox, CSP, context isolation |
| **Privacy by Design** | Compliant | Local-first, opt-in telemetry |
| **NZISM** | Aligned | Input validation, audit logging, least privilege |

---

## Incident Response

If a security vulnerability is discovered:

1. **Report** — File a security advisory on the GitHub repository.
2. **Triage** — Assess severity using CVSS scoring.
3. **Fix** — Develop and test a patch.
4. **Release** — Publish a security update via auto-update.
5. **Disclose** — Update CHANGELOG.md with security fix details.

---

## Security Test Coverage

Security-related tests are distributed across the test suite:

| Concern | Test Suite | Tests |
|---|---|---|
| SSRF protection | `api-tool.test.ts` | Blocked internal IPs |
| Path traversal | `filesystem.test.ts` | Normalised paths |
| XSS prevention | `synthesis-guard.test.ts` | Sanitsed output |
| Toast XML safety | `notification-tool.test.ts` | Escaped content |
| Permission model | `permission-requester.test.ts` | Escalation flow |
| Prompt injection | `system-prompt-authority.test.ts` | Integrity check |
| PID validation | `process-manager-tool.test.ts` | Integer-only PIDs |
| Git injection | `git-tool.test.ts` | Sanitised messages |
| IPC security | `ipc-registration.test.ts` | Allowlist enforcement |
