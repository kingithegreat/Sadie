/** @jest-environment jsdom */

import { copyTextToClipboard } from '../utils/clipboard';

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    (window as any).electron = {
      writeClipboard: jest.fn().mockResolvedValue({ success: true }),
    };
  });

  it('reports success for an empty string and forwards it unchanged', async () => {
    await expect(copyTextToClipboard('')).resolves.toBe(true);
    expect((window as any).electron.writeClipboard).toHaveBeenCalledWith('');
  });

  it('reports failure when the bridge is absent, rejects, or returns failure', async () => {
    (window as any).electron = {};
    await expect(copyTextToClipboard('missing')).resolves.toBe(false);

    const writeClipboard = jest.fn()
      .mockRejectedValueOnce(new Error('bridge rejected'))
      .mockResolvedValueOnce({ success: false, error: 'denied' });
    (window as any).electron = { writeClipboard };
    await expect(copyTextToClipboard('rejected')).resolves.toBe(false);
    await expect(copyTextToClipboard('denied')).resolves.toBe(false);
  });
});
