/**
 * SADIE / HomeBot — Lemon Squeezy implementation of LicenseService.
 * ---------------------------------------------------------------------------
 * Wraps the three LS license endpoints:
 *   POST {apiBase}/licenses/activate
 *   POST {apiBase}/licenses/validate
 *   POST {apiBase}/licenses/deactivate
 *
 * SCAFFOLD: the network shape follows the documented LS license API, but no
 * credentials are bundled. The HTTP client is injected (FetchLike) so this is
 * fully unit-testable with a fake and uses no real account in tests/CI.
 *
 * Aden's later step: create the LS store + products, enable license keys, set
 * a per-key activation limit, and put the API key/store/product ids in env.
 */
import { LicenseService, LicenseValidationResult } from './types';
import { LemonSqueezyConfig, isLemonSqueezyConfigured } from './config';

/** Minimal fetch contract so we don't hard-depend on a global fetch type. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class LemonSqueezyLicenseService implements LicenseService {
  constructor(
    private readonly cfg: LemonSqueezyConfig,
    private readonly fetchImpl: FetchLike
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // LS license endpoints accept the key in the form body; the Bearer header
      // is used for authenticated store-scoped calls. Both set here.
      Authorization: `Bearer ${this.cfg.apiKey ?? ''}`,
    };
  }

  private ensureConfigured(): LicenseValidationResult | null {
    if (!isLemonSqueezyConfigured(this.cfg)) {
      return {
        valid: false,
        error:
          'Lemon Squeezy is not configured. Set LEMONSQUEEZY_API_KEY and ' +
          'LEMONSQUEEZY_STORE_ID (Aden supplies these).',
      };
    }
    return null;
  }

  private async call(
    endpoint: 'activate' | 'validate' | 'deactivate',
    params: Record<string, string>
  ): Promise<LicenseValidationResult> {
    const notConfigured = this.ensureConfigured();
    if (notConfigured) return notConfigured;

    try {
      const res = await this.fetchImpl(`${this.cfg.apiBase}/licenses/${endpoint}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(params),
      });
      const data = await res.json().catch(() => ({}));
      return mapLemonSqueezyResponse(res.ok, data);
    } catch (err) {
      return {
        valid: false,
        error: `Lemon Squeezy request failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  activate(licenseKey: string, instanceName: string): Promise<LicenseValidationResult> {
    return this.call('activate', { license_key: licenseKey, instance_name: instanceName });
  }

  validate(licenseKey: string, instanceId?: string): Promise<LicenseValidationResult> {
    const params: Record<string, string> = { license_key: licenseKey };
    if (instanceId) params.instance_id = instanceId;
    return this.call('validate', params);
  }

  deactivate(licenseKey: string, instanceId: string): Promise<LicenseValidationResult> {
    return this.call('deactivate', { license_key: licenseKey, instance_id: instanceId });
  }
}

/** Translate a Lemon Squeezy license API payload into our neutral result. */
export function mapLemonSqueezyResponse(
  ok: boolean,
  data: any
): LicenseValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Empty response from Lemon Squeezy' };
  }
  if (data.error) {
    return { valid: false, status: data.license_key?.status, error: String(data.error) };
  }
  const valid = Boolean(ok && (data.activated === true || data.valid === true));
  return {
    valid,
    status: data.license_key?.status,
    instanceId: data.instance?.id,
    activationUsage: data.license_key?.activation_usage,
    activationLimit: data.license_key?.activation_limit,
    expiresAt: data.license_key?.expires_at ?? null,
  };
}
