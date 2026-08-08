/**
 * HomeBot / HomeBot — Embedded license-verification public key.
 * ---------------------------------------------------------------------------
 * ONLY the PUBLIC key lives here — it is safe to commit and ship. The matching
 * PRIVATE key stays with the vendor (never in the repo) and is used offline by
 * `scripts/licensing/issue-license.mjs` to mint license keys per sale.
 *
 * Rotation: run `node scripts/licensing/generate-keypair.mjs`. It prints a new
 * public key; replace the constant below (or set HOMEBOT_LICENSE_PUBLIC_KEY),
 * and keep the printed private key secret. Rotating invalidates every key
 * signed with the old private key, so only rotate deliberately.
 *
 * The env var wins when set, so CI/enterprise builds can inject their own key
 * without editing source.
 */

/**
 * Ed25519 public key, base64-encoded SPKI DER.
 * Replace with your own via `generate-keypair.mjs` before selling in your name.
 */
export const EMBEDDED_LICENSE_PUBLIC_KEY =
  'MCowBQYDK2VwAyEAKbDbv7/37/8iry01KsU6Eey2qMFQf137Xuvtl5JEKwE=';

/** Resolve the active verification public key (env override wins). */
export function getLicensePublicKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.HOMEBOT_LICENSE_PUBLIC_KEY;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : EMBEDDED_LICENSE_PUBLIC_KEY;
}
