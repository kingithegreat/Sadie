#!/usr/bin/env node
// Scan package integrity after electron-builder
// Usage: node scripts/scan-package-integrity.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fail(msg) {
  console.error('[PACKAGE SCAN] ERROR:', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('[PACKAGE SCAN]', msg);
}

const distDir = path.join(__dirname, '..', 'widget', 'dist');
if (!fs.existsSync(distDir)) {
  fail('Dist directory does not exist.');
}

// Find the .asar file
const files = fs.readdirSync(distDir);
const asarFile = files.find(f => f.endsWith('.asar'));
if (!asarFile) {
  fail('No .asar file found in dist.');
}

const asarPath = path.join(distDir, asarFile);
ok(`Found asar: ${asarPath}`);

// Extract asar to temp
const extractDir = path.join(distDir, 'asar-extract');
if (fs.existsSync(extractDir)) {
  fs.rmSync(extractDir, { recursive: true, force: true });
}
fs.mkdirSync(extractDir);

try {
  execSync(`npx asar extract "${asarPath}" "${extractDir}"`, { stdio: 'inherit' });
} catch (e) {
  fail('Failed to extract asar.');
}

ok('Extracted asar.');

// Scan for forbidden files/patterns
const forbiddenPaths = [
  '__tests__',
  'mocks',
  '.test.tsx',
  '.spec.ts',
  '.e2e.spec.ts'
];

let failed = false;

function scanDir(dir, relativePath = '') {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const relPath = path.join(relativePath, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      for (const forbidden of forbiddenPaths) {
        if (item.includes(forbidden)) {
          fail(`Forbidden directory found: ${relPath}`);
          failed = true;
        }
      }
      scanDir(fullPath, relPath);
    } else if (stat.isFile()) {
      for (const forbidden of forbiddenPaths) {
        if (item.includes(forbidden)) {
          fail(`Forbidden file found: ${relPath}`);
          failed = true;
        }
      }
    }
  }
}

scanDir(extractDir);

// Clean up
fs.rmSync(extractDir, { recursive: true, force: true });

if (failed) {
  console.error('[PACKAGE SCAN] Integrity check failed.');
  process.exit(1);
}

ok('Package integrity check passed.');