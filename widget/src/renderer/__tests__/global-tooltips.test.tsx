/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react';
import GlobalTooltips, { computePosition, resolveHelp } from '../tooltips/GlobalTooltips';
import { lookupHelp } from '../tooltips/helpText';

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

function setup(ui: React.ReactElement) {
  return render(<><GlobalTooltips />{ui}</>);
}

test('shows central help on keyboard focus immediately, wired by aria-describedby', () => {
  setup(<button>+ New Chat</button>);
  const btn = screen.getByRole('button');
  fireEvent.focusIn(btn);
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveTextContent(/fresh conversation/i);
  expect(btn.getAttribute('aria-describedby')).toContain(tip.id);
  fireEvent.focusOut(btn);
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(btn.hasAttribute('aria-describedby')).toBe(false);
});

test('shows on hover only after a delay, and hides on mouse leave', () => {
  setup(<button title="Render the video">Go!</button>);
  const btn = screen.getByRole('button');
  fireEvent.mouseOver(btn);
  expect(screen.queryByRole('tooltip')).toBeNull();
  act(() => { jest.advanceTimersByTime(500); });
  expect(screen.getByRole('tooltip')).toHaveTextContent('Render the video');
  // native title removed so it does not double up
  expect(btn.hasAttribute('title')).toBe(false);
  fireEvent.mouseOut(btn);
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('Escape dismisses; clicks pass through (bubble does not intercept)', () => {
  const onClick = jest.fn();
  setup(<button onClick={onClick} data-tooltip="Does a thing">X</button>);
  const btn = screen.getByRole('button');
  fireEvent.focusIn(btn);
  expect(screen.getByRole('tooltip')).toHaveClass('tooltip-bubble');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  fireEvent.click(btn);
  expect(onClick).toHaveBeenCalled();
});

test('settings fields get help from the label beside them', () => {
  setup(<div><label className="setting-label">🎤 Recognition engine</label><select><option>a</option></select></div>);
  fireEvent.focusIn(screen.getByRole('combobox'));
  expect(screen.getByRole('tooltip')).toHaveTextContent(/speech-to-text/i);
});

test('data-tooltip="" opts out and unknown controls show nothing', () => {
  setup(<><button data-tooltip="">Send</button><button>zzz unknown</button></>);
  for (const b of screen.getAllByRole('button')) {
    fireEvent.focusIn(b);
    expect(screen.queryByRole('tooltip')).toBeNull();
  }
});

test('lookup tolerates emoji, counts and trailing detail', () => {
  expect(lookupHelp('⚡ Export Selection (3s)')).toMatch(/selected range/);
  expect(lookupHelp('🎨 Storyboard')).toMatch(/shot by shot/);
  const b = document.createElement('button');
  b.setAttribute('aria-label', 'Close podcast section');
  b.textContent = '✕';
  expect(resolveHelp(b)).toBe('Close podcast section');
});

test('edge-aware positioning flips below and clamps to the viewport', () => {
  const rect = { top: 2, bottom: 22, left: 790, width: 20, height: 20 } as DOMRect;
  const p = computePosition(rect, 200, 30, 800, 600);
  expect(p.top).toBeGreaterThan(22);
  expect(p.left + 200).toBeLessThanOrEqual(792);
});
