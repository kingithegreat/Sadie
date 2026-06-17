/**
 * Tests for src/shared/system-prompt.ts – verifies exports shape and key content.
 */
import HOMEBOT_SYSTEM_PROMPT_DEFAULT, {
  HOMEBOT_SYSTEM_PROMPT,
  HOMEBOT_SYSTEM_PROMPT_COMPACT,
  HOMEBOT_USER_INFO,
} from '../../shared/system-prompt';

// ─── exports exist ────────────────────────────────────────────────────────────

test('HOMEBOT_SYSTEM_PROMPT is a non-empty string', () => {
  expect(typeof HOMEBOT_SYSTEM_PROMPT).toBe('string');
  expect(HOMEBOT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
});

test('HOMEBOT_SYSTEM_PROMPT_COMPACT is a non-empty string', () => {
  expect(typeof HOMEBOT_SYSTEM_PROMPT_COMPACT).toBe('string');
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT.length).toBeGreaterThan(0);
});

test('default export equals HOMEBOT_SYSTEM_PROMPT', () => {
  expect(HOMEBOT_SYSTEM_PROMPT_DEFAULT).toBe(HOMEBOT_SYSTEM_PROMPT);
});

test('HOMEBOT_USER_INFO has username and home properties', () => {
  expect(HOMEBOT_USER_INFO).toHaveProperty('username');
  expect(HOMEBOT_USER_INFO).toHaveProperty('home');
  expect(typeof HOMEBOT_USER_INFO.username).toBe('string');
  expect(typeof HOMEBOT_USER_INFO.home).toBe('string');
});

// ─── HOMEBOT_SYSTEM_PROMPT content ─────────────────────────────────────────────

test('HOMEBOT_SYSTEM_PROMPT identifies the assistant as HomeBot', () => {
  expect(HOMEBOT_SYSTEM_PROMPT).toContain('HomeBot');
});

test('HOMEBOT_SYSTEM_PROMPT includes coding section', () => {
  expect(HOMEBOT_SYSTEM_PROMPT).toMatch(/CODING/i);
});

test('HOMEBOT_SYSTEM_PROMPT includes tool-calling rules', () => {
  expect(HOMEBOT_SYSTEM_PROMPT).toMatch(/tool/i);
});

test('HOMEBOT_SYSTEM_PROMPT includes filesystem rules', () => {
  expect(HOMEBOT_SYSTEM_PROMPT).toMatch(/FILESYSTEM/i);
});

test('compact prompt is shorter than the full prompt', () => {
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT.length).toBeLessThan(HOMEBOT_SYSTEM_PROMPT.length);
});

test('compact prompt still mentions HomeBot', () => {
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT).toContain('HomeBot');
});

test('compact prompt mentions personality or conciseness', () => {
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT).toMatch(/concise|short|natural/i);
});

test('HOMEBOT_SYSTEM_PROMPT contains a length-ladder rule for short inputs', () => {
  // Guards against regressions where the "match the user's energy" rule gets diluted.
  expect(HOMEBOT_SYSTEM_PROMPT).toMatch(/LENGTH/);
  expect(HOMEBOT_SYSTEM_PROMPT).toMatch(/under 10 words|1-3 word/i);
});

test('HOMEBOT_SYSTEM_PROMPT_COMPACT contains length-ladder guidance', () => {
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT).toMatch(/LENGTH|length/);
  expect(HOMEBOT_SYSTEM_PROMPT_COMPACT).toMatch(/under 10 words|1-3 word/i);
});

// ─── HOMEBOT_USER_INFO content ──────────────────────────────────────────────────

test('HOMEBOT_USER_INFO.username is non-empty string in normal environment', () => {
  // In CI or test environments, os.userInfo() may return a valid user or 'user'
  expect(HOMEBOT_USER_INFO.username.length).toBeGreaterThan(0);
});
