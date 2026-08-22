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

/** customLLM carries its own apiKey inside a nested object. */
function stripNestedCredentials(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    delete out.apiKey;
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
    out[key] = key === 'customLLM' ? stripNestedCredentials(value) : value;
  }
  return out as Partial<T>;
}
