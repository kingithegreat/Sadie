import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OverlayPortal } from '../components/anchoredOverlay';
import { lookupHelp, normaliseLabel } from './helpText';

/**
 * GlobalTooltips — app-wide hover AND keyboard-focus help for every control.
 *
 * Wrapping hundreds of controls in <Tooltip> one by one would touch every file
 * in the renderer (and fight every open PR). Instead this single listener,
 * mounted once at the root, uses event delegation:
 *
 *   1. On mouseover (after a short delay) or focusin (immediately) it finds the
 *      nearest interactive control under the event.
 *   2. It resolves that control's help text, in order:
 *        data-tooltip  →  title (moved to data-tooltip so the native,
 *        inaccessible tooltip never doubles up)  →  the central help table
 *        (helpText.ts) keyed by the control's aria-label, visible text, or the
 *        settings label beside it  →  an aria-label that differs from the
 *        visible text (icon-only buttons).
 *   3. It draws one portalled bubble (role="tooltip", pointer-events: none),
 *      positioned against the control, flipped to the other side when there
 *      is no room and clamped inside the window, and points the control's
 *      aria-describedby at it while it is open.
 *
 * Controls already wrapped in <Tooltip> are skipped (that component owns them).
 * `data-tooltip=""` opts a control out. Escape, scroll, mousedown and blur hide
 * the bubble. Reduced motion is honoured by the shared .tooltip-bubble CSS.
 */

const BUBBLE_ID = 'hb-global-tooltip';
const HOVER_DELAY_MS = 400;
const GAP = 6;
const PAD = 8;

const CONTROL_SELECTOR = [
  'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="option"]', '[role="slider"]',
  '[data-tooltip]', '[title]',
].join(',');

function visibleText(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** The settings-style label that sits beside (not around) a form field. */
function nearbyLabel(el: HTMLElement): string {
  const field = el as HTMLInputElement;
  if (field.labels && field.labels.length) return visibleText(field.labels[0]);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const ref = document.getElementById(by.split(' ')[0]);
    if (ref) return visibleText(ref);
  }
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === 'LABEL') return visibleText(sib);
      const inner = sib.querySelector?.('label');
      if (inner) return visibleText(inner);
      sib = sib.previousElementSibling;
    }
  }
  return '';
}

export function resolveHelp(el: HTMLElement): string {
  if (el.hasAttribute('data-tooltip')) return el.getAttribute('data-tooltip') || '';
  const title = el.getAttribute('title');
  if (title) {
    // Promote the native title to our accessible tooltip, and remove it so the
    // browser does not ALSO draw its own delayed, unstyled one.
    el.setAttribute('data-tooltip', title);
    el.removeAttribute('title');
    return title;
  }
  const aria = el.getAttribute('aria-label') || '';
  const text = visibleText(el);
  const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  const candidates = isField
    ? [aria, nearbyLabel(el), el.getAttribute('placeholder') || '']
    : [aria, text];
  for (const c of candidates) {
    const hit = lookupHelp(c);
    if (hit) return hit;
  }
  // Icon-only controls: the aria-label is the only description a sighted
  // mouse user would otherwise never see.
  if (aria && normaliseLabel(aria) !== normaliseLabel(text)) return aria;
  return '';
}

function findControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(CONTROL_SELECTOR) as HTMLElement | null;
  if (!el) return null;
  if (el.closest('.tooltip-anchor')) return null; // owned by <Tooltip>
  if (el.closest('[role="tooltip"]')) return null;
  return el;
}

interface Pos { top: number; left: number }

export function computePosition(a: DOMRect, w: number, h: number, vw: number, vh: number): Pos {
  let top = a.top - h - GAP;
  if (top < PAD) top = a.bottom + GAP;          // no room above → flip below
  if (top + h > vh - PAD) top = Math.max(PAD, vh - h - PAD);
  let left = a.left + a.width / 2 - w / 2;
  left = Math.max(PAD, Math.min(left, vw - w - PAD));
  return { top, left };
}

export default function GlobalTooltips() {
  const [state, setState] = useState<{ el: HTMLElement; text: string } | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<HTMLElement | null>(null);

  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const detach = (el: HTMLElement | null) => {
    if (!el) return;
    const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== BUBBLE_ID);
    if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const hide = useCallback(() => {
    clearTimer();
    detach(current.current);
    current.current = null;
    setState(null);
    setPos(null);
  }, []);

  const show = useCallback((el: HTMLElement, immediate: boolean) => {
    clearTimer();
    const open = () => {
      const text = resolveHelp(el);
      if (!text || !el.isConnected) { hide(); return; }
      if (current.current && current.current !== el) detach(current.current);
      current.current = el;
      const ids = (el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
      if (!ids.includes(BUBBLE_ID)) el.setAttribute('aria-describedby', [...ids, BUBBLE_ID].join(' '));
      setPos(null);
      setState({ el, text });
    };
    if (immediate) open(); else timer.current = setTimeout(open, HOVER_DELAY_MS);
  }, [hide]);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const el = findControl(e.target);
      if (!el) return;
      if (el === current.current) return;
      show(el, false);
    };
    const onOut = (e: MouseEvent) => {
      const el = findControl(e.target);
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = findControl(e.target);
      if (el) show(el, true); else hide();
    };
    const onFocusOut = () => hide();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && current.current) hide(); };
    const onDown = () => hide();
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onDown, true);
    window.addEventListener('blur', onDown);
    return () => {
      clearTimer();
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onDown, true);
      window.removeEventListener('blur', onDown);
    };
  }, [show, hide]);

  useLayoutEffect(() => {
    if (!state) return;
    const b = bubbleRef.current?.getBoundingClientRect();
    setPos(computePosition(state.el.getBoundingClientRect(), b?.width ?? 0, b?.height ?? 0, window.innerWidth, window.innerHeight));
  }, [state]);

  if (!state) return null;
  return (
    <OverlayPortal>
      <span
        ref={bubbleRef}
        id={BUBBLE_ID}
        role="tooltip"
        className="tooltip-bubble tooltip-wrap hb-global-tooltip"
        style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : { position: 'fixed', opacity: 0, top: -9999, left: -9999 }}
      >
        {state.text}
      </span>
    </OverlayPortal>
  );
}
