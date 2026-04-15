/**
 * Tests for src/shared/system-prompt.ts – verifies exports shape and key content.
 */
import SADIE_SYSTEM_PROMPT_DEFAULT, {
  SADIE_SYSTEM_PROMPT,
  SADIE_SYSTEM_PROMPT_COMPACT,
  SADIE_USER_INFO,
} from '../../shared/system-prompt';

// ─── exports exist ────────────────────────────────────────────────────────────

test('SADIE_SYSTEM_PROMPT is a non-empty string', () => {
  expect(typeof SADIE_SYSTEM_PROMPT).toBe('string');
  expect(SADIE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
});

test('SADIE_SYSTEM_PROMPT_COMPACT is a non-empty string', () => {
  expect(typeof SADIE_SYSTEM_PROMPT_COMPACT).toBe('string');
  expect(SADIE_SYSTEM_PROMPT_COMPACT.length).toBeGreaterThan(0);
});

test('default export equals SADIE_SYSTEM_PROMPT', () => {
  expect(SADIE_SYSTEM_PROMPT_DEFAULT).toBe(SADIE_SYSTEM_PROMPT);
});

test('SADIE_USER_INFO has username and home properties', () => {
  expect(SADIE_USER_INFO).toHaveProperty('username');
  expect(SADIE_USER_INFO).toHaveProperty('home');
  expect(typeof SADIE_USER_INFO.username).toBe('string');
  expect(typeof SADIE_USER_INFO.home).toBe('string');
});

// ─── SADIE_SYSTEM_PROMPT content ─────────────────────────────────────────────

test('SADIE_SYSTEM_PROMPT identifies the assistant as SADIE', () => {
  expect(SADIE_SYSTEM_PROMPT).toContain('SADIE');
});

test('SADIE_SYSTEM_PROMPT includes coding section', () => {
  expect(SADIE_SYSTEM_PROMPT).toMatch(/CODING/i);
});

test('SADIE_SYSTEM_PROMPT includes tool-calling rules', () => {
  expect(SADIE_SYSTEM_PROMPT).toMatch(/tool/i);
});

test('SADIE_SYSTEM_PROMPT includes filesystem rules', () => {
  expect(SADIE_SYSTEM_PROMPT).toMatch(/FILESYSTEM/i);
});

test('compact prompt is shorter than the full prompt', () => {
  expect(SADIE_SYSTEM_PROMPT_COMPACT.length).toBeLessThan(SADIE_SYSTEM_PROMPT.length);
});

test('compact prompt still mentions SADIE', () => {
  expect(SADIE_SYSTEM_PROMPT_COMPACT).toContain('SADIE');
});

test('compact prompt mentions personality or conciseness', () => {
  expect(SADIE_SYSTEM_PROMPT_COMPACT).toMatch(/concise|short|natural/i);
});

test('SADIE_SYSTEM_PROMPT contains a length-ladder rule for short inputs', () => {
  // Guards against regressions where the "match the user's energy" rule gets diluted.
  expect(SADIE_SYSTEM_PROMPT).toMatch(/LENGTH/);
  expect(SADIE_SYSTEM_PROMPT).toMatch(/under 10 words|1-3 word/i);
});

test('SADIE_SYSTEM_PROMPT_COMPACT contains length-ladder guidance', () => {
  expect(SADIE_SYSTEM_PROMPT_COMPACT).toMatch(/LENGTH|length/);
  expect(SADIE_SYSTEM_PROMPT_COMPACT).toMatch(/under 10 words|1-3 word/i);
});

// ─── SADIE_USER_INFO content ──────────────────────────────────────────────────

test('SADIE_USER_INFO.username is non-empty string in normal environment', () => {
  // In CI or test environments, os.userInfo() may return a valid user or 'user'
  expect(SADIE_USER_INFO.username.length).toBeGreaterThan(0);
});
