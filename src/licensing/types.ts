/**
 * HomeBot / HomeBot — Licensing types (provider-agnostic).
 * ---------------------------------------------------------------------------
 * These types describe license operations behind an interface so the rest of
 * the app never depends on Lemon Squeezy directly. A different provider (or a
 * test fake) can implement LicenseService without touching callers.
 */

/** Result of a single license operation. Discriminated on `valid`. */
export interface LicenseValidationResult {
  /** True when the key is valid AND (for activation) successfully activated. */
  valid: boolean;
  /** Provider license key status, e.g. 'active' | 'inactive' | 'expired' | 'disabled'. */
  status?: string;
  /** Opaque instance id returned on activation; needed to deactivate. */
  instanceId?: string;
  /** Activation usage, when the provider reports it. */
  activationUsage?: number;
  activationLimit?: number;
  /** ISO expiry, if the plan is time-limited (lifetime → undefined/null). */
  expiresAt?: string | null;
  /** Human-readable error when valid === false. */
  error?: string;
}

/**
 * The contract every license provider implements.
 * Mirrors the three Lemon Squeezy license endpoints (activate/validate/
 * deactivate) but is intentionally generic.
 */
export interface LicenseService {
  /** Activate a key on this device; returns an instanceId on success. */
  activate(licenseKey: string, instanceName: string): Promise<LicenseValidationResult>;
  /** Validate a key (optionally a specific activation instance). */
  validate(licenseKey: string, instanceId?: string): Promise<LicenseValidationResult>;
  /** Deactivate this device's activation (frees a seat). */
  deactivate(licenseKey: string, instanceId: string): Promise<LicenseValidationResult>;
}
