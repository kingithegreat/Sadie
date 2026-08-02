#!/usr/bin/env node
/**
 * Mint a signed HomeBot Pro license key for a customer. Run this after a sale
 * (any payment method) and send the printed key to the buyer.
 *
 *   node scripts/licensing/issue-license.mjs --email buyer@example.com --name "Jane Doe"
 *   node scripts/licensing/issue-license.mjs --email buyer@example.com --days 365
 *
 * Options:
 *   --email <e>   Buyer email (recorded in the key; shown in their app).
 *   --name  <n>   Buyer name (optional).
 *   --days  <n>   Days until expiry (optional; omit for a lifetime license).
 *   --id    <s>   License id (optional; a random one is generated otherwise).
 *   --key   <p>   Path to the private key PEM (default .keys/license-signing.private.pem).
 *
 * The key is verified offline by the app against the embedded public key, so no
 * server or third-party account is involved.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, sign as edSign, randomBytes } from 'node:crypto';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keyPath = arg('--key', join(repoRoot, '.keys', 'license-signing.private.pem'));
const email = arg('--email', undefined);
const name = arg('--name', undefined);
const days = arg('--days', undefined);
const id = arg('--id', 'lic_' + randomBytes(6).toString('hex'));

let privatePem;
try {
  privatePem = readFileSync(keyPath, 'utf8');
} catch {
  console.error(`\n❌ Could not read private key at ${keyPath}.`);
  console.error('   Run: node scripts/licensing/generate-keypair.mjs first.\n');
  process.exit(1);
}

const now = Date.now();
const payload = {
  v: 1,
  tier: 'pro',
  id,
  ...(name ? { name } : {}),
  ...(email ? { email } : {}),
  iat: now,
  ...(days ? { exp: now + Number(days) * 24 * 60 * 60 * 1000 } : {}),
};

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = edSign(null, payloadBuf, createPrivateKey(privatePem));
const licenseKey = `HOMEBOT-PRO-${b64url(payloadBuf)}.${b64url(signature)}`;

console.log('\n✅ License issued:\n');
console.log(JSON.stringify(payload, null, 2));
console.log('\nSend this key to the customer (paste into Settings → HomeBot Pro):\n');
console.log('  ' + licenseKey + '\n');
