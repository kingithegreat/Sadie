import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { REDACTED, buildProblemReport, redactSettings, scrubSecrets, tailFile, writeProblemReport } from '../problem-report';

// Key-shaped test values: realistic lengths so every pattern is exercised, never real keys.
const OPENAI = 'sk-proj-' + 'A1b2C3d4E5f6G7h8I9j0'.repeat(2);
const ANTHROPIC = 'sk-ant-' + 'api03-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3'.repeat(2);
const GEMINI = 'AIza' + 'SyD3fakeGeminiKeyForTests000000000'.slice(0, 35);
const GITHUB = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

test('secret-named settings are removed at any depth; ordinary values stay readable', () => {
  const out = redactSettings({
    openaiApiKey: OPENAI,
    providerApiKeys: { anthropic: ANTHROPIC, 'google-ai-studio': GEMINI },
    customLLM: { provider: 'openai', apiKey: OPENAI, apiUrl: 'https://api.openai.com/v1', enabled: true },
    youtube: { refreshToken: 'opaque-refresh-value', clientSecret: 'shh' },
    maxTokens: 4096,
    useAuth: true,
    theme: 'dark',
    notes: `pasted ${GITHUB} by accident`,
  }) as any;
  expect(out.openaiApiKey).toBe(REDACTED);
  expect(out.providerApiKeys).toBe(REDACTED);
  expect(out.customLLM).toEqual({ provider: 'openai', apiKey: REDACTED, apiUrl: 'https://api.openai.com/v1', enabled: true });
  expect(out.youtube).toEqual({ refreshToken: REDACTED, clientSecret: REDACTED });
  expect(out).toMatchObject({ maxTokens: 4096, useAuth: true, theme: 'dark' });
  expect(out.notes).toBe(`pasted ${REDACTED} by accident`);
});

test('key-shaped values are scrubbed from free text such as logs', () => {
  const log = [
    `request with key=${GEMINI}`,
    `Authorization: Bearer ${JWT}`,
    `anthropic ${ANTHROPIC} and ${GITHUB}`,
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
    'encrypted enc:v1:QUJDREVGR0hJSktMTU5PUA==',
  ].join('\n');
  const out = scrubSecrets(log);
  for (const secret of [GEMINI, JWT, ANTHROPIC, GITHUB, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'QUJDREVGR0hJSktMTU5PUA==']) {
    expect(out).not.toContain(secret);
  }
  expect(out).toContain(`Authorization: Bearer ${REDACTED}`);
});

test('the written report has the useful parts and none of the seeded secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-report-'));
  try {
    const file = writeProblemReport({
      appVersion: '9.9.9',
      generatedAt: new Date('2026-09-17T10:00:00Z'),
      platform: { os: 'Windows_NT', release: '10.0.26200', arch: 'x64', cpu: 'Test CPU', cores: 12, memoryGb: 15.7 },
      gpus: ['NVIDIA GeForce RTX 2050, 4 GB'],
      settings: { geminiApiKey: GEMINI, theme: 'light' },
      logs: [{ name: 'startup.log', tail: `boot ok\nused ${OPENAI}` }],
      mediaJobs: [{ title: 'Harbour', state: 'needs_revision', error: `render failed (${JWT})` }],
      diagnostics: { disk: { freeGB: 120 }, hardware: { gpuName: 'RTX 2050' } },
      note: `It froze after I pasted ${GITHUB}`,
    }, dir);
    const text = fs.readFileSync(file, 'utf8');
    expect(path.basename(file)).toBe('homebot-problem-report-2026-09-17T10-00-00-000Z.txt');
    for (const part of ['HomeBot version: 9.9.9', 'RTX 2050', '"theme": "light"', 'Log: startup.log', 'boot ok',
      'Harbour — needs_revision', 'It froze after I pasted', '"freeGB": 120']) {
      expect(text).toContain(part);
    }
    for (const secret of [GEMINI, OPENAI, JWT, GITHUB]) expect(text).not.toContain(secret);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only the end of a large log is included', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-tail-'));
  try {
    const file = path.join(dir, 'big.log');
    fs.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n'));
    const tail = tailFile(file, 50);
    expect(tail.split('\n')).toHaveLength(50);
    expect(tail.endsWith('line 4999')).toBe(true);
    expect(tailFile(path.join(dir, 'missing.log'))).toBe('');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('buildProblemReport scrubs the note and job errors even without settings', () => {
  const text = buildProblemReport({ appVersion: '1', generatedAt: new Date(0), settings: {},
    platform: { os: 'x', release: 'y', arch: 'z', cpu: 'c', cores: 1, memoryGb: 1 }, logs: [], mediaJobs: [], note: GEMINI });
  expect(text).not.toContain(GEMINI);
});
