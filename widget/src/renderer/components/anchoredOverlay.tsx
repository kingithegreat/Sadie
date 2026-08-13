import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, RefObject } from 'react';

/**
 * Anchored overlays — the one way this app is allowed to float something
 * beside something else.
 *
 * This exists because the same bug has now been found four separate times:
 *
 *   - ModelSelector's dropdown (fixed ad hoc, with .model-dropdown--portal)
 *   - Tooltip (shipped invisible; found only by driving the real app)
 *   - .backend-popover — measured at 0px visible height
 *   - .reaction-picker — clipped against the top of the message scroller
 *
 * Every one is the same mistake: an absolutely-positioned overlay inside an
 * ancestor with `overflow: hidden` or `auto`. Such an element is painted and
 * then clipped away, and NO z-index rescues it — z-index orders siblings within
 * a stacking context, it does not exempt anything from an ancestor's clip.
 *
 * The app's layout makes this the default outcome rather than an edge case:
 * .app-header, .chat-interface, .messages-container and .mode-switcher all clip.
 * So any overlay that must escape its container has to leave the tree entirely.
 *
 * Two pieces, deliberately separable:
 *   useAnchoredPosition — measures the anchor and returns viewport-clamped
 *                         fixed coordinates
 *   <OverlayPortal>     — renders into document.body
 *
 * Note that jsdom cannot catch regressions here: it does no layout and paints
 * nothing, so a clipped overlay looks perfectly healthy to every unit test.
 * The guard is tooltip.e2e.spec.ts / overlay.e2e.spec.ts, which drive the real
 * renderer and assert the overlay has no clipping ancestors.
 */

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Distance between anchor and overlay. */
const GAP = 6;
/** Minimum distance from the window edge, so nothing sits flush against it. */
const PAD = 8;

export interface AnchoredPosition {
  top: number;
  left: number;
}

/**
 * Position an overlay against an anchor element, in viewport coordinates.
 *
 * Returns `null` until the overlay has been measured — render it hidden in that
 * frame rather than at 0,0, or it visibly flashes in the corner first.
 *
 * `deps` should include anything that changes the overlay's size (its content),
 * since the measurement is only as good as the moment it was taken.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  overlayRef: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement = 'top',
  deps: unknown[] = []
): AnchoredPosition | null {
  const [pos, setPos] = useState<AnchoredPosition | null>(null);

  // Reset on close so the next open measures afresh rather than flashing at the
  // previous anchor's location.
  useLayoutEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const o = overlayRef.current?.getBoundingClientRect();
    const w = o?.width ?? 0;
    const h = o?.height ?? 0;

    let top: number;
    let left: number;
    switch (placement) {
      case 'bottom': top = a.bottom + GAP; left = a.left + a.width / 2 - w / 2; break;
      case 'left':   top = a.top + a.height / 2 - h / 2; left = a.left - w - GAP; break;
      case 'right':  top = a.top + a.height / 2 - h / 2; left = a.right + GAP; break;
      default:       top = a.top - h - GAP; left = a.left + a.width / 2 - w / 2;
    }

    // Clamp into the viewport. A portalled overlay is no longer bounded by its
    // parent, so without this it happily runs off the window edge.
    left = Math.max(PAD, Math.min(left, window.innerWidth - w - PAD));
    top = Math.max(PAD, Math.min(top, window.innerHeight - h - PAD));

    setPos({ top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, ...deps]);

  return pos;
}

/**
 * The inline style for an anchored overlay: placed once measured, hidden and
 * parked off-screen until then.
 */
export function anchoredStyle(pos: AnchoredPosition | null): React.CSSProperties {
  return pos
    ? { position: 'fixed', top: pos.top, left: pos.left }
    : { position: 'fixed', opacity: 0, top: -9999, left: -9999 };
}

/** Renders children into document.body, clear of every clipping ancestor. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/**
 * Close an overlay on Escape, on outside click, and when the page scrolls.
 *
 * Scroll matters specifically for portalled overlays: the coordinates were
 * measured once against the viewport, so once the anchor moves underneath them
 * the overlay is left stranded somewhere it no longer belongs. Closing is the
 * honest response — a floating panel that has lost its anchor is worse than no
 * panel.
 */
export function useDismissOnOutside(
  open: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>
) {
  const saved = useRef(onClose);
  saved.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      refs.some((r) => r.current && t instanceof Node && r.current.contains(t));

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); saved.current(); }
    };
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) saved.current(); };
    const onScroll = () => saved.current();

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    // Capture phase: scrolling happens on inner containers, which do not bubble.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
