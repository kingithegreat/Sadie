#!/usr/bin/env node
/**
 * Generate a fresh Ed25519 license-signing keypair.
 *
 *   node scripts/licensing/generate-keypair.mjs
 *
 * - Writes the PRIVATE key to .keys/license-signing.private.pem (gitignored).
 *   Keep this file secret and backed up — it is what proves a license is real.
 *   If you lose it you can no longer issue keys; if it leaks, anyone can.
 * - Prints the PUBLIC key (base64 SPKI DER). Paste it into
 *   src/licensing/signingKey.ts (EMBEDDED_LICENSE_PUBLIC_KEY) or set
 *   HOMEBOT_LICENSE_PUBLIC_KEY in your build env.
 *
 * Rotating the keypair invalidates every previously-issued license, so only do
 * it deliberately (e.g. if the private key was exposed).
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keysDir = join(repoRoot, '.keys');
const privatePath = join(keysDir, 'license-signing.private.pem');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

mkdirSync(keysDir, { recursive: true });
writeFileSync(privatePath, privatePem, { mode: 0o600 });

console.log('\n✅ New license-signing keypair generated.\n');
console.log('Private key written to (KEEP SECRET, already gitignored):');
console.log('  ' + privatePath + '\n');
console.log('Public key — paste into src/licensing/signingKey.ts as');
console.log('EMBEDDED_LICENSE_PUBLIC_KEY (or set HOMEBOT_LICENSE_PUBLIC_KEY):\n');
console.log('  ' + publicB64 + '\n');
