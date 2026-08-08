/**
 * BrowserPanel — a real browser docked inside the workspace.
 *
 * The page itself is a BrowserView living in the main process, not an <iframe>
 * or a <webview>: Google, OpenAI and Anthropic all detect embedded webview
 * contexts and refuse to serve login pages, while a BrowserView is an ordinary
 * WebContents with its own session and passes the same checks a normal window
 * does. See main/browser-panel.ts.
 *
 * The consequence for this component: the page is NOT a child of this DOM. It
 * floats above the window at whatever rectangle main was told to use. So the
 * div below is an empty placeholder whose only job is to be measured — every
 * time it moves or resizes, we push new bounds. Anything drawn inside it would
 * be hidden underneath the page, which is why the toolbar sits outside it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserPanelState } from '../../../shared/types';

const HOME_URL = 'https://duckduckgo.com';

export default function BrowserPanel({ onClose }: { onClose: () => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [address, setAddress] = useState('');
  const [state, setState] = useState<BrowserPanelState>({
    url: '', title: '', canGoBack: false, canGoForward: false, loading: false,
  });
  const [error, setError] = useState<string | null>(null);

  const api = (window as any).electron;

  /** Measure the placeholder and tell main where to put the page. */
  const pushBounds = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // getBoundingClientRect is relative to the viewport, which for this
    // frameless window is the same origin BrowserView bounds use.
    void api?.browserBounds?.({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [api]);

  // Attach on mount, detach on unmount. Detach leaves the page alive in main,
  // so reopening the panel returns to the same tab and session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const el = viewportRef.current;
      const r = el?.getBoundingClientRect();
      const res = await api?.browserAttach?.(
        HOME_URL,
        r ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined,
      );
      if (!cancelled && res && !res.success) setError(res.error || 'Could not open the browser panel.');
    })();
    return () => {
      cancelled = true;
      void api?.browserDetach?.();
    };
  }, [api]);

  // Keep the page glued to the placeholder. ResizeObserver catches layout
  // changes (sidebar toggled, terminal opened); the window listeners catch
  // moves that don't change this element's size but do change its position.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => pushBounds());
    ro.observe(el);
    window.addEventListener('resize', pushBounds);
    window.addEventListener('scroll', pushBounds, true);
    pushBounds();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', pushBounds);
      window.removeEventListener('scroll', pushBounds, true);
    };
  }, [pushBounds]);

  // Live url/title/loading as the user clicks around inside the page.
  useEffect(() => {
    const off = api?.onBrowserState?.((s: BrowserPanelState) => {
      setState(s);
      // Don't fight the user mid-type: only sync the address bar when it isn't
      // focused, or every navigation would wipe what they were typing.
      if (document.activeElement?.getAttribute('data-browser-address') !== 'true') {
        setAddress(s.url);
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [api]);

  const go = useCallback(async () => {
    const res = await api?.browserNavigate?.(address);
    setError(res && !res.success ? (res.error || 'Could not open that address.') : null);
  }, [api, address]);

  return (
    <section className="browser-panel" aria-label="Browser">
      <div className="browser-toolbar">
        <button
          className="browser-btn" onClick={() => void api?.browserBack?.()}
          disabled={!state.canGoBack} title="Back" aria-label="Back"
        >‹</button>
        <button
          className="browser-btn" onClick={() => void api?.browserForward?.()}
          disabled={!state.canGoForward} title="Forward" aria-label="Forward"
        >›</button>
        <button
          className="browser-btn" onClick={() => void api?.browserReload?.()}
          title="Reload" aria-label="Reload"
        >↻</button>

        <input
          className="browser-address"
          data-browser-address="true"
          value={address}
          spellCheck={false}
          placeholder="Search or enter address"
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void go(); }}
          aria-label="Address"
        />

        <button className="browser-btn" onClick={() => void go()} title="Go" aria-label="Go">→</button>
        <button className="browser-btn" onClick={onClose} title="Close browser" aria-label="Close browser">✕</button>
      </div>

      {state.loading && <div className="browser-loading" role="status">Loading…</div>}
      {error && <div className="browser-error">{error}</div>}

      {/* Measured only — the page is painted over this by the main process. */}
      <div className="browser-viewport" ref={viewportRef} />
    </section>
  );
}
