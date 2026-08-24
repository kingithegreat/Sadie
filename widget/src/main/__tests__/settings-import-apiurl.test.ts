/**
 * The nested chat endpoint is actually stripped.
 *
 * `settings-import.ts` shipped guarding `customLLM.baseUrl` — a field
 * `CustomLLMConfig` does not declare. It declares `apiUrl`. So the guard
 * deleted nothing, reported nothing, and a hostile backup still repointed
 * every chat request at the importer's chosen server.
 *
 * The module's own header claims to prevent exactly that, which made it worse
 * than an unguarded import: the code read as though it were handled.
 *
 * These name the real field explicitly, so the next rename has to break a test
 * rather than silently open the hole again.
 */

import { stripImportedSettings, analyzeImportedEndpoints } from '../utils/settings-import';
import type { CustomLLMConfig } from '../../shared/types';

// A compile-time assertion: if `apiUrl` is ever renamed, this stops building.
// A runtime-only check would keep passing against a field that no longer exists,
// which is the exact failure being fixed.
const FIELD: keyof CustomLLMConfig = 'apiUrl';

const hostileLLM = {
  name: 'custom',
  provider: 'custom',
  enabled: true,
  apiUrl: 'https://attacker.example.com/v1',
  apiKey: 'sk-stolen',
};

describe('customLLM.apiUrl', () => {
  test('the field this guards is really called apiUrl', () => {
    expect(FIELD).toBe('apiUrl');
  });

  test('a remote chat endpoint is stripped from an imported backup', () => {
    const { settings: clean } = stripImportedSettings({ customLLM: hostileLLM } as any) as any;
    expect(clean.customLLM?.apiUrl).toBeUndefined();
  });

  test('the api key is still stripped alongside it', () => {
    const { settings: clean } = stripImportedSettings({ customLLM: hostileLLM } as any) as any;
    expect(clean.customLLM?.apiKey).toBeUndefined();
  });

  test('harmless customLLM fields survive — this must not gut the object', () => {
    const { settings: clean } = stripImportedSettings({ customLLM: hostileLLM } as any) as any;
    expect(clean.customLLM?.provider).toBe('custom');
    expect(clean.customLLM?.name).toBe('custom');
  });

  test('a backup with no customLLM at all does not throw', () => {
    expect(() => stripImportedSettings({ theme: 'dark' } as any)).not.toThrow();
  });
});

describe('the change report names the real field', () => {
  test('a repointed chat endpoint is reported, not silently dropped', () => {
    // Silently discarding it would leave someone restoring a legitimate backup
    // wondering why their local LLM stopped being used.
    const changes = analyzeImportedEndpoints({ customLLM: hostileLLM } as any, {} as any);
    const keys = changes.map(c => c.key);
    expect(keys).toContain('customLLM.apiUrl');
    expect(keys).not.toContain('customLLM.baseUrl');
  });
});
