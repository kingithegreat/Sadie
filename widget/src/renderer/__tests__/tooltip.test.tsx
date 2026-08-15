/** @jest-environment jsdom */
/**
 * tooltip.test.tsx
 *
 * The acceptance bar for this component is specific: "every interactive control
 * explains itself on hover AND keyboard focus". These tests assert the half
 * that a native `title` attribute cannot do — focus, Escape, and the ARIA
 * wiring — because that half is the entire reason the component exists.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import Tooltip from '../components/Tooltip';

const HELP = 'Send the message';

function renderTip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
  return render(
    <Tooltip content={HELP} delayMs={100} {...props}>
      <button>Send</button>
    </Tooltip>
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('Tooltip — keyboard users', () => {
  test('appears on focus, with no delay', () => {
    renderTip();
    // Not shown before interaction.
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(screen.getByRole('button'));
    // Deliberately NO timer advance: focus is an explicit request for this
    // control, so waiting would be wrong.
    expect(screen.getByRole('tooltip')).toHaveTextContent(HELP);
  });

  test('disappears on blur', () => {
    renderTip();
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('Escape dismisses it without moving focus', () => {
    renderTip();
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.focus(btn);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    // The control keeps focus — dismissing help must not cost you your place.
    expect(document.activeElement).toBe(btn);
  });
});

describe('Tooltip — pointer users', () => {
  test('waits the delay before appearing, so skimming the UI is quiet', () => {
    renderTip();
    fireEvent.mouseEnter(screen.getByRole('button').parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByRole('tooltip')).toHaveTextContent(HELP);
  });

  test('leaving before the delay elapses shows nothing at all', () => {
    renderTip();
    const anchor = screen.getByRole('button').parentElement!;
    fireEvent.mouseEnter(anchor);
    act(() => { jest.advanceTimersByTime(50); });
    fireEvent.mouseLeave(anchor);
    act(() => { jest.advanceTimersByTime(500); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('Tooltip — assistive technology', () => {
  test('links the control to the help text while it is showing', () => {
    renderTip();
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveAttribute('aria-describedby');

    fireEvent.focus(btn);
    const tip = screen.getByRole('tooltip');
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id);
  });

  test('drops the link when hidden, leaving no dangling reference', () => {
    renderTip();
    const btn = screen.getByRole('button');
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    expect(btn).not.toHaveAttribute('aria-describedby');
  });
});

describe('Tooltip — when it should do nothing', () => {
  test('renders the child untouched with no content', () => {
    render(<Tooltip content=""><button>Send</button></Tooltip>);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    // No wrapper either — an empty tooltip must not alter the DOM around a
    // control, or it changes layout for nothing.
    expect(document.querySelector('.tooltip-anchor')).toBeNull();
  });

  test('honours `disabled`', () => {
    renderTip({ disabled: true });
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('does not fire a pending timer after unmount', () => {
    const { unmount } = renderTip();
    fireEvent.mouseEnter(screen.getByRole('button').parentElement!);
    unmount();
    // A timer surviving its component is how the widget suite used to hang.
    expect(() => act(() => { jest.advanceTimersByTime(500); })).not.toThrow();
  });
});
