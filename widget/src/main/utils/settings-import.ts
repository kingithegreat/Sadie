/**
 * Settings import guard — what a backup file is allowed to change.
 *
 * A backup file is an arbitrary JSON document someone handed to the app. Two
 * classes of key must never survive a restore silently:
 *
 * 1. Credentials (CREDENTIAL_SETTING_KEYS) — stripped unconditionally. There
 *    is no restore flow that legitimately needs a backup to overwrite API
 *    keys; users who want that copy them through Settings.
 *
 * 2. Endpoints (ENDPOINT_SETTING_KEYS, plus customLLM.baseUrl) — these decide
 *    WHERE traffic goes: the n8n host that receives chat and automation
 *    requests stamped with X-HOMEBOT-Auth, the Ollama/SearXNG/Code-API hosts,
 *    and the custom-LLM base URL. A malicious backup that repoints them turns
 *    HomeBot into a faithful exporter of every conversation — and delivers
 *    the webhook secret to the attacker's host on the first webhook call.
 *    Unlike credentials these have a legitimate migration use, so they are
 *    not stripped blindly: the caller compares analyzeImportedEndpoints()
 *    against current settings, asks the user when something would move, and
 *    strips them (skipEndpoints=true) when nobody can be asked.
 */

/** Settings keys that hold credentials or secret-bearing values. */
const CREDENTIAL_SETTING_KEYS: ReadonlySet<string> = new Set([
  'n8nApiKey',
  'tavilyApiKey',
  'serperApiKey',
  'stableHordeApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'geminiApiKey',
  'moonshotApiKey',
  'codeApiKey',
  'providerApiKeys', // one key per cloud provider, encrypted per value
  'calendarIcsUrl', // private "Secret address" iCal URL — bearer credential
]);

/**
 * Top-level settings keys whose value is a traffic destination. Nested
 * customLLM.baseUrl is handled alongside these — see below.
 */
const ENDPOINT_SETTING_KEYS: ReadonlySet<string> = new Set([
  'n8nUrl', // receives chat + automation calls carrying X-HOMEBOT-Auth
  'ollamaUrl',
  'searxngUrl',
  'codeApiUrl',
]);

/** customLLM carries its own apiKey AND its own endpoint inside one object. */
function stripNestedCredentials(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    delete out.apiKey;
    return out;
  }
  return value;
}

function stripNestedEndpoint(value: unknown): { value: unknown; stripped: boolean } {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, 'baseUrl')) return { value, stripped: false };
    const out: Record<string, unknown> = { ...obj };
    delete out.baseUrl;
    return { value: out, stripped: true };
  }
  return { value, stripped: false };
}

export interface EndpointChange {
  key: string;
  from?: string;
  to?: string;
}

function normalize(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t.replace(/\/+$/, '');
}

/**
 * Which traffic endpoints would this import MOVE? Only reports endpoints the
 * import actually sets to a different value than current — an absent key or
 * an unchanged one is nobody's business.
 */
export function analyzeImportedEndpoints(
  imported: unknown,
  current: unknown
): EndpointChange[] {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) return [];
  const imp = imported as Record<string, unknown>;
  const cur =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const changes: EndpointChange[] = [];

  for (const key of ENDPOINT_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(imp, key)) continue;
    const to = normalize(imp[key]);
    const from = normalize(cur[key]);
    if (to && to !== from) changes.push({ key, from, to });
  }

  if (
    imp.customLLM &&
    typeof imp.customLLM === 'object' &&
    Object.prototype.hasOwnProperty.call(imp.customLLM, 'baseUrl')
  ) {
    const to = normalize((imp.customLLM as Record<string, unknown>).baseUrl);
    const curLlm = cur.customLLM;
    const from =
      curLlm && typeof curLlm === 'object'
        ? normalize((curLlm as Record<string, unknown>).baseUrl)
        : undefined;
    if (to && to !== from) changes.push({ key: 'customLLM.baseUrl', from, to });
  }

  return changes;
}

/**
 * Return a copy of imported settings with credential keys removed and nested
 * credential fields (customLLM.apiKey) stripped. Non-object input yields an
 * empty result — callers merge it harmlessly.
 *
 * Endpoints are NOT touched here; route imports through stripImportedSettings
 * so the caller can decide (or ask) before they land.
 */
export function sanitizeImportedSettings<T extends Record<string, unknown>>(imported: T): Partial<T> {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
    return {} as Partial<T>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(imported)) {
    if (CREDENTIAL_SETTING_KEYS.has(key)) continue;
    out[key] = key === 'customLLM' ? stripNestedCredentials(value) : value;
  }
  return out as Partial<T>;
}

/**
 * sanitizeImportedSettings, then also remove every traffic endpoint. Returns
 * which ones were removed so the caller can say so out loud.
 */
export function stripImportedSettings<T extends Record<string, unknown>>(
  imported: T
): { settings: Partial<T>; strippedEndpoints: string[] } {
  const sanitized = sanitizeImportedSettings(imported) as Record<string, unknown>;
  const strippedEndpoints: string[] = [];
  for (const key of ENDPOINT_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      delete sanitized[key];
      strippedEndpoints.push(key);
    }
  }
  if (
    sanitized.customLLM &&
    typeof sanitized.customLLM === 'object' &&
    Object.prototype.hasOwnProperty.call(sanitized.customLLM, 'baseUrl')
  ) {
    const res = stripNestedEndpoint(sanitized.customLLM);
    sanitized.customLLM = res.value;
    if (res.stripped) strippedEndpoints.push('customLLM.baseUrl');
  }
  return { settings: sanitized as Partial<T>, strippedEndpoints };
}
