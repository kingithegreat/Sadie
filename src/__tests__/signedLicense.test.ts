/**
 * Offline signed license — verification round-trip and rejection tests.
 * Uses an ephemeral keypair so the test never depends on the embedded key.
 */
import { generateKeyPairSync, KeyObject } from 'crypto';
import {
  signLicense,
  verifySignedLicense,
  looksLikeSignedLicense,
  LICENSE_PAYLOAD_VERSION,
  LicensePayload,
} from '../licensing/signedLicense';

function pubB64(pub: KeyObject): string {
  return pub.export({ type: 'spki', format: 'der' }).toString('base64');
}

function makePayload(over: Partial<LicensePayload> = {}): LicensePayload {
  return { v: LICENSE_PAYLOAD_VERSION, tier: 'pro', id: 'lic_test', iat: 1_000, ...over };
}

describe('signed license', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const pub = pubB64(publicKey);

  test('a validly-signed Pro key verifies and returns its payload', () => {
    const key = signLicense(makePayload({ email: 'a@b.com' }), privateKey);
    const res = verifySignedLicense(key, pub, 2_000);
    expect(res.valid).toBe(true);
    expect(res.payload?.tier).toBe('pro');
    expect(res.payload?.email).toBe('a@b.com');
  });

  test('looksLikeSignedLicense recognises the prefix', () => {
    const key = signLicense(makePayload(), privateKey);
    expect(looksLikeSignedLicense(key)).toBe(true);
    expect(looksLikeSignedLicense('LEMON-XXXX')).toBe(false);
  });

  test('a key signed by a different private key is rejected', () => {
    const key = signLicense(makePayload(), other.privateKey);
    expect(verifySignedLicense(key, pub).valid).toBe(false);
  });

  test('a tampered payload is rejected', () => {
    const key = signLicense(makePayload(), privateKey);
    const [head, sig] = key.replace('HOMEBOT-PRO-', '').split('.');
    // Flip the payload to a forged one but keep the original signature.
    const forged = 'HOMEBOT-PRO-' + Buffer.from(JSON.stringify(makePayload({ id: 'forged' })))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sig;
    expect(head).toBeTruthy();
    expect(verifySignedLicense(forged, pub).valid).toBe(false);
  });

  test('an expired key is rejected', () => {
    const key = signLicense(makePayload({ exp: 5_000 }), privateKey);
    expect(verifySignedLicense(key, pub, 4_000).valid).toBe(true);
    expect(verifySignedLicense(key, pub, 6_000).valid).toBe(false);
  });

  test('a non-Pro payload does not grant Pro', () => {
    const key = signLicense(makePayload({ tier: 'free' as any }), privateKey);
    expect(verifySignedLicense(key, pub).valid).toBe(false);
  });

  test('an unsupported version is rejected', () => {
    const key = signLicense(makePayload({ v: 99 }), privateKey);
    expect(verifySignedLicense(key, pub).valid).toBe(false);
  });

  test('malformed keys fail cleanly', () => {
    expect(verifySignedLicense('', pub).valid).toBe(false);
    expect(verifySignedLicense('HOMEBOT-PRO-nodot', pub).valid).toBe(false);
    expect(verifySignedLicense('garbage', pub).valid).toBe(false);
  });

  test('the embedded public key can verify a key issued by its private counterpart', () => {
    // Proves the shipped default keypair is internally consistent: sign with the
    // repo private key, verify with the embedded public key.
    const fs = require('fs');
    const path = require('path');
    const privPath = path.join(__dirname, '..', '..', '.keys', 'license-signing.private.pem');
    if (!fs.existsSync(privPath)) return; // skip if the dev private key isn't present
    const priv = fs.readFileSync(privPath, 'utf8');
    const { EMBEDDED_LICENSE_PUBLIC_KEY } = require('../licensing/signingKey');
    const key = signLicense(makePayload(), priv);
    expect(verifySignedLicense(key, EMBEDDED_LICENSE_PUBLIC_KEY).valid).toBe(true);
  });
});
