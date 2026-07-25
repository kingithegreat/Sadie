# Selling HomeBot Pro

HomeBot ships with a working **offline license system** so you can charge for
Pro **today** — no licensing service, no server, no monthly fees. You hold a
private signing key, mint a signed key per sale, and the app verifies it
offline against an embedded public key. A paying customer's Pro entitlement is
cryptographically guaranteed; a non-customer cannot forge one.

## What's Free vs Pro

Free is a genuinely useful product (this drives adoption): local + cloud
(bring-your-own-key) chat, model selector, diagnostics, themes, and safe
read-only tools. **Pro** unlocks the paid moat: the **Automation Center**
(scheduled + triggered workflows, and the chat commands that create/run them),
the full write/execute/system tool library, RAG/Knowledge Stacks, voice,
morning briefings, image generation, and advanced permission controls. The
tier→feature map is the single source of truth in `src/entitlements.ts`.

Enforcement is at the handler layer (not just the UI), so a Free user cannot
unlock Pro by editing the renderer, hand-editing `license.json` (the cache is
HMAC-signed and machine-bound), or asking the assistant to create an automation
(the chat tools are gated too).

## One-time setup

1. **Generate your signing keypair** (do this on a machine you control):

   ```bash
   node scripts/licensing/generate-keypair.mjs
   ```

   This writes the **private** key to `.keys/license-signing.private.pem`
   (gitignored — keep it secret and backed up) and prints the **public** key.

2. **Embed your public key.** Paste the printed value into
   `src/licensing/signingKey.ts` (`EMBEDDED_LICENSE_PUBLIC_KEY`), or set
   `HOMEBOT_LICENSE_PUBLIC_KEY` in your build env. Rebuild.

   > The repo ships with a working default keypair so the flow runs out of the
   > box, **but you should generate your own before selling** so the private key
   > is yours alone.

3. **Set your checkout URL.** Point `HOMEBOT_CHECKOUT_URL` at your purchase page
   (Gumroad, Ko-fi, a Stripe Payment Link, Lemon Squeezy hosted checkout — your
   choice). This is where the in-app "Upgrade to Pro" button sends users.

## Per sale

When someone buys, mint their key:

```bash
node scripts/licensing/issue-license.mjs --email buyer@example.com --name "Jane Doe"
# time-limited (e.g. a 1-year subscription):
node scripts/licensing/issue-license.mjs --email buyer@example.com --days 365
```

Send them the printed `HOMEBOT-PRO-…` key. They paste it into
**Settings → HomeBot Pro** and Pro unlocks immediately — fully offline.

You can automate this: most checkout platforms can call a webhook or run a
script on purchase; wire that to `issue-license.mjs` and email the key
automatically.

## What the customer gets

- Instant activation, works offline forever (re-validation is local).
- The license is bound to their machine on activation, so casually copying
  `license.json` to another machine won't unlock it.
- Lifetime keys never expire; `--days` keys stop granting Pro after expiry and
  the app cleanly falls back to Free.

## Revoking / rotating

- To **revoke everything** (e.g. a leaked private key): run
  `generate-keypair.mjs` again, embed the new public key, and ship an update.
  All previously-issued keys stop working — so rotate only deliberately.
- Per-key revocation for a single refund/chargeback is not built in; the offline
  model trades that for zero infrastructure. If you need it, keep an issued-key
  log and move to the Lemon Squeezy path (`LEMONSQUEEZY_*` env vars) which
  validates online and supports per-key deactivation.

## Security notes

- Only the **public** key is committed/shipped. The private key must never be
  committed (`.keys/` and `*.private.pem` are gitignored).
- The on-disk entitlement cache is HMAC-signed and bound to a machine
  fingerprint, so it can't be hand-edited to grant Pro.
- The embedded public key is not a secret — it can only *verify*, not *sign*.
