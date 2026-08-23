/**
 * Settings keys that hold credentials or secret-bearing values. A backup file
 * is an arbitrary JSON document someone handed to the app — restoring it must
 * not be able to silently replace API keys or point cloud traffic at an
 * attacker-chosen authenticated endpoint. These keys are stripped on import;
 * users who genuinely want to migrate them can copy them via Settings.
 */
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
 * Settings keys naming a service HomeBot then SENDS things to.
 *
 * The header of this file has always claimed importing a backup "must not
 * silently... point cloud traffic at an attacker-chosen authenticated
 * endpoint" — and only credentials were ever stripped, so every one of these
 * survived an import. That is worse than repointing alone: requests to `n8nUrl`
 * are stamped with the per-install webhook secret by `homebotWebhookHeaders()`,
 * so a handed-over backup both redirects the traffic and delivers the secret to
 * wherever it now points. Chat content follows `customLLM.apiUrl` the same way.
 */
const ENDPOINT_SETTING_KEYS: ReadonlySet<string> = new Set([
  'n8nUrl',
  'ollamaUrl',
  'qdrantUrl',
  'codeApiUrl',
  'searxngUrl',
]);

/**
 * Is this address on this machine?
 *
 * Loopback endpoints are kept, because that is what a real backup contains —
 * almost everyone runs n8n, Ollama and Qdrant locally, and stripping
 * `http://localhost:5678` would break every honest restore to defend against
 * nothing. Anything that leaves the machine is dropped.
 *
 * The bracket handling is not incidental: `new URL('http://[::1]/').hostname`
 * returns `"[::1]"` WITH the brackets, so comparing against `'::1'` matches
 * nothing and a v6 loopback would be treated as remote. The same oversight in
 * reverse once left an SSRF check open.
 */
export function isLoopbackEndpoint(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

    if (host === 'localhost' || host === '::1') return true;
    // 127.0.0.0/8 — all of it, not just 127.0.0.1.
    if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

    // IPv4-mapped IPv6. Node NORMALISES these to hex, so `::ffff:127.0.0.1`
    // arrives as `::ffff:7f00:1` and a dotted-form check never fires. Caught by
    // its own test, which is the only reason this is right.
    const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      // The first octet is the top byte of the first group; 127 is 0x7f.
      if (Number.isFinite(high) && (high >> 8) === 127) return true;
    }
    // The dotted spelling too, in case a future parser stops normalising.
    if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;

    return false;
  } catch {
    // Unparseable is not trustworthy.
    return false;
  }
}

/** customLLM carries its own apiKey inside a nested object, and its own endpoint. */
function stripNestedCredentials(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    delete out.apiKey;
    // Where chat goes. Kept only when it points at this machine — a local
    // llama.cpp or LM Studio survives a restore; a remote one does not.
    if ('apiUrl' in out && !isLoopbackEndpoint(out.apiUrl)) {
      delete out.apiUrl;
    }
    return out;
  }
  return value;
}

/**
 * Return a copy of imported settings with credential-bearing keys removed and
 * nested credential fields (customLLM.apiKey) stripped. Non-object input
 * yields an empty result — callers merge it harmlessly.
 */
export function sanitizeImportedSettings<T extends Record<string, unknown>>(imported: T): Partial<T> {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
    return {} as Partial<T>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(imported)) {
    if (CREDENTIAL_SETTING_KEYS.has(key)) continue;
    // A remote endpoint in a backup is the attack this file exists to stop.
    // Loopback survives, because that is what an honest backup contains.
    if (ENDPOINT_SETTING_KEYS.has(key) && !isLoopbackEndpoint(value)) continue;
    out[key] = key === 'customLLM' ? stripNestedCredentials(value) : value;
  }
  return out as Partial<T>;
}

/**
 * Which service addresses an import would drop, so the caller can say so.
 *
 * Silently discarding them would leave someone restoring a legitimate backup
 * wondering why their remote n8n stopped working, with nothing to read. Naming
 * them turns a mystery into a two-minute re-entry in Settings.
 */
export function droppedEndpoints(imported: Record<string, unknown>): string[] {
  if (!imported || typeof imported !== 'object' || Array.isArray(imported)) return [];

  const dropped: string[] = [];
  for (const key of ENDPOINT_SETTING_KEYS) {
    if (key in imported && !isLoopbackEndpoint(imported[key])) dropped.push(key);
  }

  const custom = imported.customLLM;
  if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
    const apiUrl = (custom as Record<string, unknown>).apiUrl;
    if (apiUrl !== undefined && !isLoopbackEndpoint(apiUrl)) dropped.push('customLLM.apiUrl');
  }

  return dropped;
}
