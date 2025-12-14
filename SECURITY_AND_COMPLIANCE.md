# SADIE Security & Compliance

This document outlines SADIE's security architecture, compliance measures, and hardening strategies for safe deployment.

## Security Overview

SADIE implements defense-in-depth security with environment-based gating, code isolation, and runtime validation to prevent accidental exposure of development artifacts in production.

## Environment Hardening

### Environment Variables

SADIE uses environment variables to control runtime behavior and security gates:

| Variable | Purpose | Dev | Test | Prod |
|----------|---------|-----|------|------|
| `NODE_ENV` | Runtime mode | `development` | `test` | `production` |
| `SADIE_E2E` | Enable E2E testing | `false` | `true` | `false` |
| `SADIE_DIRECT_OLLAMA` | Bypass model validation | `false` | `true` | `false` |

### Runtime Mode Detection

The application automatically detects runtime context:

```typescript
// From env.ts
export const isE2E = process.env.SADIE_E2E === 'true';
export const isPackagedBuild = app.isPackaged;
export const isReleaseBuild = process.env.NODE_ENV === 'production' && isPackagedBuild;
```

### Environment Sanitization

In production builds, sensitive environment variables are sanitized:

```typescript
// From env.ts
export function sanitizeEnvForPackaged(): void {
  if (isReleaseBuild) {
    // Remove development/test variables
    delete process.env.SADIE_E2E;
    delete process.env.SADIE_DIRECT_OLLAMA;
    // Sanitize NODE_ENV
    process.env.NODE_ENV = 'production';
  }
}
```

## Release Gating Logic

### Diagnostic Logging Control

Debug and diagnostic logs are gated based on runtime mode:

```typescript
// Example from config-manager.ts
if (!isReleaseBuild) {
  console.log('[DIAG] Config path:', configPath);
}
```

**Result:** Production builds have clean logs, development builds retain diagnostics.

### Test Code Exclusion

Test utilities and mocks are conditionally included:

```typescript
// From message-router.ts
if (isE2E) {
  // Enable streaming mocks for testing
  setupMockHandlers();
}
```

**Guarantee:** Test code never ships in production packages.

## URL Safety Validator

The `fetch_url` tool implements comprehensive URL validation to prevent SSRF attacks:

### Validation Checks

1. **Protocol Validation**
   - Only `http://` and `https://` allowed
   - Blocks `file://`, custom protocols

2. **Hostname Security**
   - Blocks loopback addresses (`localhost`, `127.0.0.1`, `::1`)
   - Blocks private IPv4 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
   - DNS resolution validation for all A/AAAA records

3. **Domain Filtering**
   - Blocks known search engine domains in results
   - Prevents recursive search engine queries

### Implementation

```typescript
// From web.ts
async function isUrlSafe(urlString: string): Promise<{ ok: boolean; message?: string }> {
  // Comprehensive validation logic
  // Returns { ok: true } or { ok: false, message: "reason" }
}
```

## IPC Permission Model

### Secure IPC Channels

SADIE uses Electron's context isolation with validated IPC communication:

| IPC Channel | Purpose | Validation |
|-------------|---------|------------|
| `get-config` | Retrieve settings | Read-only access |
| `save-config` | Persist settings | Input sanitization |
| `get-config-path` | Debug config location | Release-gated |
| `chat-message` | AI interactions | Content validation |

### Context Isolation

- Main process: Node.js environment with full system access
- Renderer process: Isolated browser context
- Preload script: Secure bridge between contexts

### Input Validation

All IPC inputs are validated before processing:

```typescript
// Example validation
if (typeof message !== 'string' || message.length > 10000) {
  return { success: false, error: 'Invalid message format' };
}
```

## Runtime Modes

SADIE supports three operational modes with different security postures:

### Demo Mode
- Full functionality for evaluation
- Local Ollama integration
- Web search capabilities
- Configurable settings

### Beta Mode
- Feature-complete for testing
- Enhanced logging for feedback
- Error reporting enabled
- Pre-release features

### Production Mode
- Hardened security gates
- Clean logging (no diagnostics)
- Sanitized environment
- Optimized performance

## Compliance Measures

### Data Protection
- No user data collection without consent
- Local AI processing (Ollama)
- Config stored in userData directory
- No telemetry in production

### Code Integrity
- Preflight environment checks
- Package integrity scanning
- Dependency auditing (`npm audit`)
- Signed releases (future enhancement)

### Network Security
- URL validation for web requests
- DNS rebinding protection
- Private network blocking
- Timeout limits on requests

## Security Testing

### Automated Checks
- Preflight script validates environment
- Package scanner checks for forbidden content
- Unit tests verify gating logic
- E2E tests confirm runtime behavior

### Manual Verification
- Review packaged ASAR contents
- Check production logs for leaks
- Validate IPC security boundaries
- Test URL safety validator

## Threat Model

### Attack Vectors Mitigated

1. **Accidental Test Code Exposure**
   - Environment gating prevents test utilities in production

2. **Debug Information Leakage**
   - Diagnostic logs gated for release builds

3. **SSRF via Web Tools**
   - Comprehensive URL validation blocks internal access

4. **IPC Exploitation**
   - Input validation and context isolation

5. **Environment Variable Injection**
   - Sanitization removes sensitive variables in production

### Residual Risks

- Local Ollama model security (user responsibility)
- UserData directory permissions
- System-level Electron vulnerabilities (mitigated by updates)

## Future Security Enhancements

- Code signing for releases
- Automatic dependency updates
- Runtime integrity checks
- Advanced threat detection