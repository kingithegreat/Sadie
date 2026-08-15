/** @jest-environment jsdom */
/**
 * A handler passed into the header must reach a control the user can press.
 *
 * "Export this chat" was sixteen lines of real work in App.tsx — it walked the
 * messages, skipped system turns, formatted each as `### **You** — <time>`,
 * joined them with rules and called window.electron.exportChat. It was handed
 * to StatusIndicator, which destructured the prop as `_onExportChat` and
 * dropped it. HeaderActions was never given it, so no button was ever drawn.
 *
 * Nothing was broken in a way any existing test could see: App.tsx passed the
 * prop, StatusIndicator accepted it, both typechecked, and the feature did not
 * exist. That is the defect this file is aimed at — a prop that is accepted and
 * discarded — so each case asserts the round trip, from prop to a real click.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import StatusIndicator from '../components/StatusIndicator';
import { ConnectionStatus } from '../../shared/types';

beforeAll(() => {
  (window as any).electron = {
    getUncensoredMode: jest.fn().mockResolvedValue({ enabled: false }),
    startOllama: jest.fn(),
  };
});

afterAll(() => { delete (window as any).electron; });

const online: ConnectionStatus = { n8n: 'online', ollama: 'online' } as any;

async function renderHeader(extra: Record<string, unknown> = {}) {
  await act(async () => {
    render(
      <StatusIndicator
        connectionStatus={online}
        onRefresh={jest.fn()}
        onSettingsClick={jest.fn()}
        {...extra}
      />,
    );
  });
}

/**
 * Every optional handler the header takes, with the control it must produce.
 * Adding a handler to StatusIndicatorProps without wiring it to a button is
 * exactly how export chat went missing, so the list is the guard.
 */
const HANDLERS: Array<{ prop: string; label: RegExp }> = [
  { prop: 'onExportChat', label: /export chat/i },
  { prop: 'onToolsClick', label: /view tools/i },
  { prop: 'onRagClick', label: /rag index/i },
  { prop: 'onTerminalClick', label: /terminal/i },
  { prop: 'onWorkspaceClick', label: /workspace/i },
  { prop: 'onAnalyticsClick', label: /analytics/i },
  { prop: 'onNotificationsClick', label: /notifications/i },
];

describe('header handlers reach a control', () => {
  for (const { prop, label } of HANDLERS) {
    it(`${prop} renders a button that calls it`, async () => {
      const handler = jest.fn();
      await renderHeader({ [prop]: handler });

      const button = screen.getByRole('button', { name: label });
      fireEvent.click(button);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it(`${prop} renders no button when it is not supplied`, async () => {
      await renderHeader();
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    });
  }
});
