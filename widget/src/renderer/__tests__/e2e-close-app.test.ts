import { closeElectronApp, CLOSE_BUDGET_MS } from '../e2e/helpers/closeApp';

/**
 * The teardown budget that stopped a hung quit from failing tests that had
 * already passed (overlay.e2e's right-click test, four unrelated PRs).
 */
describe('closeElectronApp', () => {
  const app = (close: () => Promise<void>, kill = jest.fn()) =>
    ({ close, process: () => ({ kill }) }) as unknown as Parameters<typeof closeElectronApp>[0];

  it('returns as soon as the app closes, and does not kill it', async () => {
    const kill = jest.fn();
    const elapsed = await closeElectronApp(app(async () => { await new Promise(r => setTimeout(r, 20)); }, kill));
    expect(kill).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(CLOSE_BUDGET_MS);
  });

  it('kills an app that never exits, instead of hanging until the test times out', async () => {
    jest.useFakeTimers();
    try {
      const kill = jest.fn();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const pending = closeElectronApp(app(() => new Promise<void>(() => {}), kill), 'stuck app');
      jest.advanceTimersByTime(CLOSE_BUDGET_MS);
      await pending;
      expect(kill).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatch(/stuck app did not exit within 20000ms/);
      warn.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });
});
