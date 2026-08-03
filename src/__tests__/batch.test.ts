
// ── formatBatchPreviewForChat (issue #6 wiring) ─────────────────────────────
import { formatBatchPreviewForChat, buildBatchPreview } from '../trust/batch';

describe('formatBatchPreviewForChat', () => {
  const preview = (over: Partial<import('../trust/batch').BatchPreview> = {}) => buildBatchPreview([
    { name: 'write_file', args: { path: '/tmp/a.txt' }, known: true, requiresConfirmation: true, requiredPermissions: ['write_file'], permissionGranted: true },
    { name: 'crm_create_deal', args: { title: 'Website', valueCents: 450000 }, known: true, requiresConfirmation: false, requiredPermissions: [], permissionGranted: false },
    { name: 'made_up_tool', args: {}, known: false, requiresConfirmation: false, requiredPermissions: [], permissionGranted: false },
  ]);

  it('renders one numbered line per call with args summaries', () => {
    const text = formatBatchPreviewForChat(preview());
    expect(text).toContain('About to run 3 actions:');
    expect(text).toContain('1. write_file (path: /tmp/a.txt)');
    expect(text).toContain('2. crm_create_deal (');
  });
  it('marks permission-pending and unknown tools honestly', () => {
    const text = formatBatchPreviewForChat(preview());
    expect(text).toContain('crm_create_deal');
    expect(text).toContain('will ask permission first');
    expect(text).toContain('made_up_tool ');
    expect(text).toContain('unknown tool, will be skipped');
  });
  it('singular wording for a one-action batch', () => {
    const p = buildBatchPreview([
      { name: 'get_weather', args: {}, known: true, requiresConfirmation: false, requiredPermissions: [], permissionGranted: true },
    ]);
    expect(formatBatchPreviewForChat(p)).toContain('About to run 1 action:');
  });
});
