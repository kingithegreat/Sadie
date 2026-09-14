/**
 * Tests for shared/connections-catalogue.ts.
 *
 * The catalogue is data a non-technical person will act on, so most of what
 * can break is prose: a missing "where to get" link, an entry that builds a
 * config mcp-client would reject, a cost badge that overpromises. These tests
 * hold that line.
 */
import {
  CONNECTIONS,
  buildServerConfig,
  describeCost,
  findConnection,
} from '../../shared/connections-catalogue';

describe('connections catalogue', () => {
  test('every entry is complete enough to act on', () => {
    for (const entry of CONNECTIONS) {
      expect(entry.id.trim()).toBeTruthy();
      expect(entry.name.trim()).toBeTruthy();
      // The whole point: say what it reaches before connecting.
      expect(entry.reach.length).toBeGreaterThan(20);
      // A stored name is how duplicates are detected later.
      expect(entry.serverName.trim()).toBeTruthy();
      expect(entry.command.trim()).toBeTruthy();
      expect(Array.isArray(entry.args)).toBe(true);
      expect(entry.docsUrl.startsWith('https://')).toBe(true);
      for (const k of entry.keys) {
        expect(k.key).toMatch(/^[A-Z0-9_]+$/);
        expect(k.label.trim()).toBeTruthy();
        // Nobody can paste a key they cannot find.
        expect(k.whereToGet.startsWith('https://')).toBe(true);
      }
    }
  });

  test('ids are unique', () => {
    const ids = CONNECTIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('at least one entry needs nothing but a click', () => {
    // The brief is "best option for free or very cheap" — a catalogue where
    // every card demands a key first has no door in it.
    expect(CONNECTIONS.some((c) => c.keys.length === 0 && c.cost === 'free-local')).toBe(true);
  });

  test('findConnection matches ids case-insensitively and rejects junk', () => {
    expect(findConnection('Notion')?.id).toBe('notion');
    expect(findConnection('  GITHUB ')?.id).toBe('github');
    expect(findConnection('Google-Drive')?.id).toBe('google-drive');
    expect(findConnection('drive')?.id).toBe('google-drive');
    expect(findConnection('gdrive')?.id).toBe('google-drive');
    expect(findConnection('docs')?.id).toBe('google-drive');
    expect(findConnection('google-docs')?.id).toBe('google-drive');
    expect(findConnection('Gmail')?.id).toBe('gmail');
    expect(findConnection('email')?.id).toBe('gmail');
    expect(findConnection('mail')?.id).toBe('gmail');
    expect(findConnection('nope')).toBeUndefined();
    expect(findConnection(42)).toBeUndefined();
    expect(findConnection(undefined)).toBeUndefined();
  });
});

describe('buildServerConfig', () => {
  const notion = findConnection('notion')!;
  const memory = findConnection('memory')!;

  test('refuses to build a half-filled config, naming what is missing', () => {
    const built = buildServerConfig(notion, {});
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error).toContain(notion.keys[0].label);
    }
  });

  test('a blank value counts as missing', () => {
    const token = notion.keys[0].key;
    const built = buildServerConfig(notion, { [token]: '   ' });
    expect(built.ok).toBe(false);
  });

  test('notion composes its env header from the collected token', () => {
    const token = notion.keys[0].key;
    const built = buildServerConfig(notion, { [token]: 'ntn_test123' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.config.type).toBe('stdio');
    expect(built.config.command).toBe(notion.command);
    expect(built.config.args).toEqual(notion.args);
    expect(built.config.enabled).toBe(true);
    const header = JSON.parse(built.config.env!.OPENAPI_MCP_HEADERS);
    expect(header.Authorization).toBe('Bearer ntn_test123');
    expect(header['Notion-Version']).toBeTruthy();
  });

  test('a keyless entry connects with no values at all', () => {
    const built = buildServerConfig(memory, {});
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.config.env).toBeUndefined();
  });

  test('values are trimmed before use', () => {
    const token = notion.keys[0].key;
    const built = buildServerConfig(notion, { [token]: '  ntn_spaced  ' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const header = JSON.parse(built.config.env!.OPENAPI_MCP_HEADERS);
    expect(header.Authorization).toBe('Bearer ntn_spaced');
  });

  test('google-drive and gmail configure correct commands, args, and credentials env', () => {
    const gdrive = findConnection('google-drive')!;
    expect(gdrive).toBeDefined();
    const gdriveBuilt = buildServerConfig(gdrive, { GDRIVE_CREDENTIALS_PATH: 'C:/keys/gdrive.json' });
    expect(gdriveBuilt.ok).toBe(true);
    if (gdriveBuilt.ok) {
      expect(gdriveBuilt.config.command).toBe('npx');
      expect(gdriveBuilt.config.args).toContain('@modelcontextprotocol/server-gdrive');
      expect(gdriveBuilt.config.env?.GDRIVE_CREDENTIALS_PATH).toBe('C:/keys/gdrive.json');
    }

    const gmail = findConnection('gmail')!;
    expect(gmail).toBeDefined();
    const gmailBuilt = buildServerConfig(gmail, { GMAIL_CREDENTIALS_PATH: 'C:/keys/gmail.json' });
    expect(gmailBuilt.ok).toBe(true);
    if (gmailBuilt.ok) {
      expect(gmailBuilt.config.command).toBe('npx');
      expect(gmailBuilt.config.args).toContain('mcp-server-gmail');
      expect(gmailBuilt.config.env?.GMAIL_CREDENTIALS_PATH).toBe('C:/keys/gmail.json');
    }
  });
});

describe('describeCost', () => {
  test('never promises paid features as free', () => {
    for (const entry of CONNECTIONS) {
      const label = describeCost(entry);
      if (entry.cost === 'paid-account') {
        expect(label.toLowerCase()).toContain('paid');
      } else {
        expect(label.toLowerCase()).toContain('free');
      }
    }
  });
});
