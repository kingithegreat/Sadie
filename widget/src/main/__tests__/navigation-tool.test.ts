/**
 * The navigation primitive, tested at the seam that actually matters: does a
 * model-supplied argument object end up as an IPC message the renderer can act
 * on, and does a bad one come back with something the model can correct from.
 *
 * The registration test is not ceremony. `shared/modes.ts` described a
 * `navigate_to_mode` tool for a long time while no such tool existed, and this
 * codebase's characteristic bug is a capability that works and that nothing
 * reaches — so "is it actually in the registry" is the assertion most worth
 * having here.
 */

const sentMessages: Array<{ channel: string; payload: unknown }> = [];
let windowExists = true;
let minimized = false;
const shown: string[] = [];

jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () =>
      windowExists
        ? [
            {
              isDestroyed: () => false,
              isMinimized: () => minimized,
              restore: () => shown.push('restore'),
              show: () => shown.push('show'),
              webContents: {
                send: (channel: string, payload: unknown) =>
                  sentMessages.push({ channel, payload }),
              },
            },
          ]
        : [],
  },
}));

import {
  navigateToModeDef,
  navigateToModeHandler,
  navigationToolDefs,
  navigationToolHandlers,
} from '../tools/navigation';
import { NAV_CHANNEL } from '../../shared/navigation';
import { APP_MODES } from '../../shared/modes';

beforeEach(() => {
  sentMessages.length = 0;
  shown.length = 0;
  windowExists = true;
  minimized = false;
});

describe('navigate_to_mode', () => {
  test('sends the renderer a navigation it can act on', async () => {
    const result = await navigateToModeHandler({ mode: 'automation' }, {} as any);

    expect(result.success).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].channel).toBe(NAV_CHANNEL);
    expect(sentMessages[0].payload).toMatchObject({ mode: 'automation' });
  });

  test('carries the payload across, which is what makes it a handoff', async () => {
    await navigateToModeHandler({
      mode: 'automation',
      payload: { name: 'Morning news', instructions: 'Summarise the headlines' },
      reason: 'Opening Automations so you can save this.',
    }, {} as any);

    expect(sentMessages[0].payload).toEqual({
      mode: 'automation',
      payload: { name: 'Morning news', instructions: 'Summarise the headlines' },
      reason: 'Opening Automations so you can save this.',
    });
  });

  test('reports whether context travelled, so the model knows what it handed over', async () => {
    const withContext = await navigateToModeHandler({ mode: 'quiz', payload: { topic: 'Kanji' } }, {} as any);
    const without = await navigateToModeHandler({ mode: 'quiz' }, {} as any);

    expect((withContext.result as any).carriedContext).toBe(true);
    expect((without.result as any).carriedContext).toBe(false);
  });

  test('surfaces a minimised window — navigating one nobody can see is the same dead end', async () => {
    minimized = true;
    await navigateToModeHandler({ mode: 'media' }, {} as any);

    expect(shown).toEqual(['restore', 'show']);
  });

  test('rejects an unknown mode by naming the real ones, so the model can retry', async () => {
    const result = await navigateToModeHandler({ mode: 'code' }, {} as any);

    expect(result.success).toBe(false);
    expect(sentMessages).toHaveLength(0);
    // The destinations have to appear in the error or the model is guessing.
    expect(result.error).toContain('automation');
    expect(result.error).toContain('media');
  });

  test('fails cleanly when there is no window rather than throwing', async () => {
    windowExists = false;
    const result = await navigateToModeHandler({ mode: 'chat' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no app window/i);
  });

  test('every mode the app has is a destination the model may choose', () => {
    // Guards the drift modes.ts exists to prevent: a panel added to the mode
    // list but never offered to the assistant is unreachable from chat.
    expect(navigateToModeDef.parameters.properties.mode.enum).toEqual([...APP_MODES]);
  });

  test('is exported in the shape the registry consumes', () => {
    expect(navigationToolDefs).toContain(navigateToModeDef);
    expect(navigationToolHandlers.navigate_to_mode).toBe(navigateToModeHandler);
  });
});
