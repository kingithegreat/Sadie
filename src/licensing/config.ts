/**
 * SADIE / HomeBot — Lemon Squeezy config from env PLACEHOLDERS.
 * ---------------------------------------------------------------------------
 * NO secrets here. Aden supplies the real Lemon Squeezy account, store, and
 * keys later (see .env.example). Until then these read as undefined and the
 * app stays on the Free tier with zero license calls.
 *
 * Required for Pro activation (set by Aden in .env / CI secrets, never committed):
 *   LEMONSQUEEZY_API_KEY     — LS API key (Bearer)         [secret]
 *   LEMONSQUEEZY_STORE_ID    — numeric store id
 *   LEMONSQUEEZY_PRODUCT_ID  — Pro product id (license validation scoping)
 * Optional:
 *   LEMONSQUEEZY_CHECKOUT_URL — deep link used in upgrade prompts
 */
export interface LemonSqueezyConfig {
  apiKey?: string;
  storeId?: string;
  productId?: string;
  checkoutUrl?: string;
  /** LS API base; overridable for tests. */
  apiBase: string;
}

export function loadLemonSqueezyConfig(
  env: NodeJS.ProcessEnv = process.env
): LemonSqueezyConfig {
  return {
    apiKey: env.LEMONSQUEEZY_API_KEY,
    storeId: env.LEMONSQUEEZY_STORE_ID,
    productId: env.LEMONSQUEEZY_PRODUCT_ID,
    checkoutUrl: env.LEMONSQUEEZY_CHECKOUT_URL,
    apiBase: env.LEMONSQUEEZY_API_BASE || 'https://api.lemonsqueezy.com/v1',
  };
}

/** True only when the minimum config to talk to LS is present. */
export function isLemonSqueezyConfigured(cfg: LemonSqueezyConfig): boolean {
  return Boolean(cfg.apiKey && cfg.storeId);
}
