/**
 * Browser control — the safety shape, not the browser.
 *
 * Driving a real BrowserView needs a running Electron window, so these cover
 * what can go wrong WITHOUT one, which is also what matters most: this browser
 * holds Aden's logged-in sessions. A click here can spend money or send a
 * message, so the interesting assertions are about what is gated and what is
 * refused, not about whether a page loads.
 */

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => require('os').tmpdir()),
    getAppPath: jest.fn(() => require('os').tmpdir()),
  },
  ipcMain: { on: jest.fn(), handle: jest.fn(), removeHandler: jest.fn() },
  BrowserView: jest.fn(),
  BrowserWindow: jest.fn().mockImplementation(() => ({ webContents: { send: jest.fn() } })),
  shell: { openExternal: jest.fn() },
}));

import {
  browserControlToolDefs,
  browserControlToolHandlers,
} from '../tools/browser-control';

const call = (name: string, args: any = {}) =>
  browserControlToolHandlers[name](args, { executionId: 'test' } as any);

describe('what is gated', () => {
  const byName = Object.fromEntries(browserControlToolDefs.map(d => [d.name, d]));

  it('acting on the page needs confirmation; reading it does not', () => {
    // Reading is safe and frequent — gating it would train the user to click
    // through prompts, which is how a confirmation stops meaning anything.
    expect(byName.read_browser_page.requiresConfirmation).toBeFalsy();
    expect(byName.list_browser_targets.requiresConfirmation).toBeFalsy();

    expect(byName.click_browser_target.requiresConfirmation).toBe(true);
    expect(byName.type_in_browser.requiresConfirmation).toBe(true);
    expect(byName.navigate_browser.requiresConfirmation).toBe(true);
  });

  it('every tool declares a category, or a small model can never be offered it', () => {
    for (const d of browserControlToolDefs) expect(d.category).toBe('web');
  });

  it('tells the model to list targets before clicking', () => {
    // The numbering only means anything against a fresh list; a stale index
    // clicks the wrong thing on a page that has changed.
    expect(byName.click_browser_target.description).toMatch(/list_browser_targets/);
    expect(byName.type_in_browser.description).toMatch(/list_browser_targets/);
  });
});

describe('addresses are checked before anything opens', () => {
  it('refuses a non-web scheme', async () => {
    const res: any = await call('navigate_browser', { url: 'file:///C:/Windows/System32' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/http/i);
  });

  it('refuses nonsense rather than guessing', async () => {
    const res: any = await call('navigate_browser', { url: 'not a url at all' });
    expect(res.success).toBe(false);
  });

  it('refuses an empty address', async () => {
    const res: any = await call('navigate_browser', { url: '   ' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no address/i);
  });
});

describe('acting with no panel open', () => {
  it('says the panel is closed instead of failing obscurely', async () => {
    const res: any = await call('read_browser_page', {});
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/not open/i);
  });

  it('refuses a click with no target number', async () => {
    const res: any = await call('click_browser_target', {});
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/list_browser_targets/);
  });

  it('refuses typing with nothing to type', async () => {
    const res: any = await call('type_in_browser', { target: 0, text: '' });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/nothing to type/i);
  });
});
