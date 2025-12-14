#!/usr/bin/env node
// Preflight check to prevent releasing with test/dev flags set
// Usage:
//   node scripts/preflight-env-check.js [--require-production]

const args = process.argv.slice(2);
const requireProduction = args.includes('--require-production');
const scanArtifacts = args.includes('--scan-artifacts');

function fail(msg) {
  console.error('[PREFLIGHT] ERROR:', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('[PREFLIGHT]', msg);
}

if (process.env.SKIP_PREFLIGHT === '1' || process.env.SKIP_PREFLIGHT === 'true') {
  ok('SKIP_PREFLIGHT set; skipping checks.');
  process.exit(0);
}

// Dangerous flags that must not be present in release builds
const dangerousFlags = ['SADIE_E2E', 'SADIE_DIRECT_OLLAMA'];
let failed = false;
for (const f of dangerousFlags) {
  if (process.env[f] !== undefined && process.env[f] !== '') {
    fail(`Environment variable ${f} is set (${String(process.env[f])}). This is not allowed for release builds.`);
    failed = true;
  }
}

if (requireProduction) {
  const nodeEnv = process.env.NODE_ENV || '';
  if (nodeEnv !== 'production') {
    fail(`NODE_ENV is not 'production' (NODE_ENV='${nodeEnv}'). For release jobs, set NODE_ENV=production.`);
    failed = true;
  } else {
    ok('NODE_ENV=production');
  }
} else {
  ok('Production NODE_ENV not enforced (no --require-production).');
}

if (scanArtifacts) {
  const fs = require('fs');
  const path = require('path');
  
  const distDir = path.join(__dirname, '..', 'widget', 'dist');
  if (!fs.existsSync(distDir)) {
    fail('Dist directory does not exist. Run build first.');
    failed = true;
  } else {
    const forbiddenStrings = ['[E2E-MOCK]', '[DIAG]'];
    const scanDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (stat.isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const str of forbiddenStrings) {
            if (content.includes(str)) {
              fail(`Forbidden string "${str}" found in ${fullPath}`);
              failed = true;
            }
          }
        }
      }
    };
    scanDir(distDir);
    if (!failed) {
      ok('No forbidden strings found in artifacts.');
    }
  }
}

if (failed) {
  console.error('[PREFLIGHT] One or more preflight checks failed. Aborting.');
  process.exit(1);
}

console.log('[PREFLIGHT] All checks passed.');
process.exit(0);
