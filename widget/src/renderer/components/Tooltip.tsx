import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { OverlayPortal, anchoredStyle, useAnchoredPosition } from './anchoredOverlay';
import type { Placement } from './anchoredOverlay';

/**
 * Tooltip — hover help that also works for people who do not use a mouse.
 *
 * The app had no tooltip primitive at all; where help existed it was the native
 * `title` attribute. That is not good enough for the stated bar — "every
 * interactive control explains itself on hover AND keyboard focus" — because
 * a native title:
 *
 *   - never appears on keyboard focus, only on hover, so tabbing through the
 *     UI surfaces nothing;
 *   - has an uncontrollable ~1s delay and vanishes after a few seconds;
 *   - cannot be styled, so it does not match the app;
 *   - is not reliably announced by screen readers, and is not aria-describedby.
 *
 * This wraps a single interactive child and adds:
 *   - show on mouseenter and on focus-visible, hide on leave/blur
 *   - a delay on hover (pointer skims across controls) but NONE on focus
 *     (a keyboard user asked for this control deliberately)
 *   - Escape to dismiss without moving focus
 *   - aria-describedby wiring, so the text is announced rather than merely drawn
 *
 * Deliberately unconditional about one thing: it renders nothing at all when
 * `content` is empty, rather than an empty bubble.
 *
 * The bubble is PORTALLED to document.body and positioned fixed, not absolutely
 * positioned beside the trigger. It has to be: the first version drew correctly
 * — right size, opacity 1, z-index 2000 — and was invisible anyway, because
 * three ancestors clip it (.mode-switcher overflow:auto, .app-header
 * overflow:hidden, and a wrapper div overflow:hidden). Nothing absolutely
 * positioned escapes overflow:hidden, whatever its z-index.
 *
 * No unit test could have caught that: jsdom does no layout and paints nothing.
 * It took driving the real app and looking at a screenshot. See
 * anchoredOverlay.tsx, which now owns the portal-and-position logic for every
 * floating overlay in the app.
 */

export type TooltipPlacement = Placement;

export interface TooltipProps {
  /** The help text. An empty value disables the tooltip entirely. */
  content: ReactNode;
  /** Exactly one interactive element. */
  children: ReactElement;
  placement?: TooltipPlacement;
  /** Hover delay in ms. Focus always shows immediately. */
  delayMs?: number;
  /** Escape hatch for tests and for controls that manage their own state. */
  disabled?: boolean;
}

export default function Tooltip({
  content,
  children,
  placement = 'top',
  delayMs = 350,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const pos = useAnchoredPosition(anchorRef, bubbleRef, open, placement, [content]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const tooltipId = `tt-${id}`;

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A tooltip that outlives its trigger keeps a timer alive and can fire into a
  // dead component. Same class of bug as the timers that stopped the test suite
  // exiting — clean up on unmount, always.
  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(
    (immediate: boolean) => {
      if (disabled || !content) return;
      clearTimer();
      if (immediate) {
        setOpen(true);
        return;
      }
      timer.current = setTimeout(() => setOpen(true), delayMs);
    },
    [clearTimer, content, delayMs, disabled]
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // Escape closes the tooltip without moving focus, so a keyboard user can
  // dismiss an obscuring bubble and stay where they are.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, hide]);

  if (disabled || !content) return children;

  const describedBy = open ? tooltipId : undefined;

  return (
    <span
      ref={anchorRef}
      className="tooltip-anchor"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      // Focus is a deliberate request for this control, so no delay — and
      // focusin/out rather than focus/blur so a focusable descendant counts.
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {/* aria-describedby only while open: pointing at an element that is not
          in the DOM would leave a dangling reference for assistive tech. */}
      {describedBy ? cloneElement(children, { 'aria-describedby': describedBy } as Partial<unknown>) : children}
      {open && (
        <OverlayPortal>
          <span
            ref={bubbleRef}
            role="tooltip"
            id={tooltipId}
            className={`tooltip-bubble tooltip-${placement}`}
            // Hidden until measured, so it never flashes at 0,0 first.
            style={anchoredStyle(pos)}
          >
            {content}
          </span>
        </OverlayPortal>
      )}
    </span>
  );
}
