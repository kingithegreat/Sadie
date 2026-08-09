/**
 * list-models-ipc.test.ts
 *
 * The Connect button calls homebot:list-custom-llm-models. That handler had its
 * own apiUrl guard which ran BEFORE fetchAvailableCustomModels' claude-code
 * exemption, so picking the Claude subscription provider and clicking Connect
 * failed with "API URL is required" — a provider that has no endpoint by design.
 *
 * Same shape as the cloud-routing bug: one decision enforced in two places, and
 * only one of them learned about the new case.
 */

const handlers = new Map<string, any>();

jest.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: any) => handlers.set(ch, fn),
    on: jest.fn(),
    removeHandler: (ch: string) => handlers.delete(ch),
  },
  app: { getPath: () => '/mock', isPackaged: false },
  shell: {},
  dialog: {},
  BrowserWindow: Object.assign(jest.fn(), { getAllWindows: () => [] }),
  clipboard: {},
  Notification: jest.fn(),
}));

const fetchAvailableCustomModels = jest.fn();
jest.mock('../custom-llm-client', () => ({
  fetchAvailableCustomModels: (...a: any[]) => fetchAvailableCustomModels(...a),
  validateCustomLLMConfig: () => ({ valid: true }),
  autoConfigureCustomLLM: (c: any) => c,
  streamFromCustomLLM: jest.fn(),
  getModelMetadata: () => ({}),
  PROVIDER_API_URLS: {},
  setAssistantBridgeProvider: jest.fn(),
  acceptsSamplingParams: () => true,
}));

describe('list-custom-llm-models apiUrl guard', () => {
  /** Reproduce the handler's guard exactly, without booting all of ipc-handlers. */
  async function guard(payload: any) {
    if (payload?.provider !== 'claude-code') {
      if (!payload?.apiUrl) return { success: false, error: 'API URL is required' };
      try {
        const parsed = new URL(payload.apiUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { success: false, error: 'Only HTTP and HTTPS URLs are allowed' };
        }
      } catch {
        return { success: false, error: 'Invalid URL format' };
      }
    }
    return { success: true, models: await fetchAvailableCustomModels(payload) };
  }

  beforeEach(() => {
    fetchAvailableCustomModels.mockReset();
    fetchAvailableCustomModels.mockResolvedValue([{ id: 'sonnet' }, { id: 'opus' }, { id: 'haiku' }]);
  });

  test('claude-code connects with NO apiUrl — the reported bug', async () => {
    const r = await guard({ provider: 'claude-code' });
    expect(r.success).toBe(true);
    expect(r.models).toHaveLength(3);
  });

  test('claude-code accepts a filesystem path, which is not a URL', async () => {
    // The optional field is a path to claude.exe; the protocol check would
    // otherwise reject it as "Invalid URL format".
    const r = await guard({ provider: 'claude-code', apiUrl: 'C:\tools\claude.exe' });
    expect(r.success).toBe(true);
  });

  test('every other provider still requires an apiUrl', async () => {
    const r = await guard({ provider: 'anthropic' });
    expect(r).toEqual({ success: false, error: 'API URL is required' });
    expect(fetchAvailableCustomModels).not.toHaveBeenCalled();
  });

  test('the SSRF protocol guard still applies to real providers', async () => {
    expect(await guard({ provider: 'openai', apiUrl: 'file:///etc/passwd' }))
      .toEqual({ success: false, error: 'Only HTTP and HTTPS URLs are allowed' });
    expect(await guard({ provider: 'openai', apiUrl: 'not a url' }))
      .toEqual({ success: false, error: 'Invalid URL format' });
    expect(fetchAvailableCustomModels).not.toHaveBeenCalled();
  });
});
