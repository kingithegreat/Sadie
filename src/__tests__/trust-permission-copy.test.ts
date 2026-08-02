/**
 * Trust layer — permission copy tests (issue #6 copy/accessibility pass).
 *
 * The registry itself is exercised for shape (every entry has a non-empty
 * label + detail, details are real sentences); resolution is exercised for
 * the three tiers (known / MCP heuristic / fallback) and the reason +
 * timeout helpers the modal renders.
 */
import {
  KNOWN_PERMISSION_COPY,
  describePermission,
  prettifyPermissionName,
  isMachineReason,
  resolveHumanReason,
  formatTimeoutNotice,
} from '../trust/permission-copy';

describe('KNOWN_PERMISSION_COPY registry shape', () => {
  test('has entries and every entry has non-empty label and sentence-like detail', () => {
    const names = Object.keys(KNOWN_PERMISSION_COPY);
    expect(names.length).toBeGreaterThan(80);
    for (const name of names) {
      const copy = KNOWN_PERMISSION_COPY[name];
      expect(copy.label.trim().length).toBeGreaterThan(2);
      // Labels are short verb phrases, not slugs.
      expect(copy.label).not.toMatch(/_/);
      // Details are full sentences ending in a period.
      expect(copy.detail.trim()).toMatch(/\.$/);
      expect(copy.detail.trim().length).toBeGreaterThan(15);
    }
  });

  test('spot-checks: sensitive permissions say exactly what they grant', () => {
    expect(KNOWN_PERMISSION_COPY.write_file.detail).toMatch(/overwrite/i);
    expect(KNOWN_PERMISSION_COPY.delete_file.detail).toMatch(/permanently remove/i);
    expect(KNOWN_PERMISSION_COPY.email_send.detail).toMatch(/send an email/i);
    expect(KNOWN_PERMISSION_COPY.run_code.detail).toMatch(/execute code/i);
    expect(KNOWN_PERMISSION_COPY.screenshot.detail).toMatch(/screen/i);
  });
});

describe('describePermission', () => {
  test('known names resolve from the registry', () => {
    const d = describePermission('write_file');
    expect(d.source).toBe('known');
    expect(d.label).toBe('Write files');
    expect(d.name).toBe('write_file');
  });

  test('mcp_<server>_<tool> names resolve via the MCP heuristic', () => {
    const d = describePermission('mcp_ytdlp_download_video');
    expect(d.source).toBe('mcp');
    expect(d.label).toBe('Download video');
    expect(d.detail).toContain('ytdlp');
  });

  test('unknown names fall back to a prettified slug, never throw', () => {
    const d = describePermission('file_write');
    expect(d.source).toBe('fallback');
    expect(d.label).toBe('File write');
    expect(d.detail.length).toBeGreaterThan(0);
  });

  test('empty string is handled without throwing', () => {
    const d = describePermission('');
    expect(d.source).toBe('fallback');
    expect(typeof d.label).toBe('string');
  });
});

describe('prettifyPermissionName', () => {
  test('replaces underscores/dashes and capitalises the first word only', () => {
    expect(prettifyPermissionName('get_video_info')).toBe('Get video info');
    expect(prettifyPermissionName('some-mixed_name')).toBe('Some mixed name');
  });
});

describe('reason filtering', () => {
  test('machine-generated "Requires permissions:" reasons are recognised', () => {
    expect(isMachineReason('Requires permissions: fs_write, email_send')).toBe(true);
    expect(isMachineReason('  requires permission: x ')).toBe(true);
  });

  test('human reasons pass through trimmed', () => {
    expect(resolveHumanReason('  Saving your weekly report to Documents.  ')).toBe(
      'Saving your weekly report to Documents.',
    );
  });

  test('machine reasons, empty and missing reasons resolve to null', () => {
    expect(resolveHumanReason('Requires permissions: write_file')).toBeNull();
    expect(resolveHumanReason('   ')).toBeNull();
    expect(resolveHumanReason(undefined)).toBeNull();
    expect(resolveHumanReason(null)).toBeNull();
  });
});

describe('formatTimeoutNotice', () => {
  test('default 60s reads as "about a minute"', () => {
    expect(formatTimeoutNotice(60000)).toContain('about a minute');
  });

  test('short timeouts read in seconds, long ones in minutes', () => {
    expect(formatTimeoutNotice(15000)).toContain('about 15 seconds');
    expect(formatTimeoutNotice(300000)).toContain('about 5 minutes');
  });

  test('bad input falls back to the 60s default and always states auto-decline', () => {
    for (const bad of [undefined, null, NaN, -5, 0]) {
      const notice = formatTimeoutNotice(bad as any);
      expect(notice).toContain('about a minute');
      expect(notice).toMatch(/declines the request automatically/);
    }
  });
});
