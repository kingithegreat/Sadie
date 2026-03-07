/**
 * WebServicesPanel.tsx
 *
 * Embeds ChatGPT, Claude, and Gemini as full persistent webviews so users can
 * use their existing subscriptions without needing API keys.
 *
 * Each service gets its own Electron session partition (`persist:<id>`) so
 * login is saved between app restarts. Webviews are mounted once and only
 * shown/hidden to preserve session state across tab switches.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

const SERVICES = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    icon: '🤖',
    url: 'https://chatgpt.com',
    color: '#10a37f',
  },
  {
    id: 'claude',
    label: 'Claude',
    icon: '◆',
    url: 'https://claude.ai',
    color: '#d97706',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: '✦',
    url: 'https://gemini.google.com/app',
    color: '#4285f4',
  },
] as const;

type ServiceId = (typeof SERVICES)[number]['id'];

// Must match the UA set on session partitions in main/index.ts
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Helper: get the home URL for a service id
function homeUrl(id: ServiceId): string {
  return SERVICES.find(s => s.id === id)!.url;
}

const WebServicesPanel: React.FC = () => {
  const [active, setActive] = useState<ServiceId>('chatgpt');
  // Track which tabs have been loaded at least once (lazy loading)
  const [loaded, setLoaded] = useState<Set<ServiceId>>(new Set(['chatgpt']));
  // Path to the built webview preload script (exposed by preload/index.ts)
  const webviewPreload: string = (window as any)._webviewPreload || '';
  // Navigation bar URL display per service
  const [displayUrls, setDisplayUrls] = useState<Record<ServiceId, string>>({
    chatgpt: SERVICES[0].url,
    claude: SERVICES[1].url,
    gemini: SERVICES[2].url,
  });
  // Loading spinner state per service
  const [loading, setLoading] = useState<Record<ServiceId, boolean>>({
    chatgpt: false,
    claude: false,
    gemini: false,
  });
  // Nav bar URL edit state
  const [editUrl, setEditUrl] = useState('');
  const [editingUrl, setEditingUrl] = useState(false);

  const webviewRefs = useRef<Record<ServiceId, HTMLElement | null>>({
    chatgpt: null,
    claude: null,
    gemini: null,
  });

  // Get typed webview element
  const wv = useCallback((id: ServiceId): any => webviewRefs.current[id], []);

  // Activate a tab (lazy-load its webview)
  const activateTab = useCallback((id: ServiceId) => {
    setActive(id);
    setLoaded(prev => new Set([...prev, id]));
    setEditingUrl(false);
    setEditUrl(displayUrls[id]);
  }, [displayUrls]);

  // Attach navigation listeners to each webview after mount
  useEffect(() => {
    SERVICES.forEach(({ id }) => {
      const el = wv(id);
      if (!el) return;

      const onNavStart = () => {
        setLoading(prev => ({ ...prev, [id]: true }));
      };
      const onNavStop = () => {
        setLoading(prev => ({ ...prev, [id]: false }));
        setDisplayUrls(prev => ({ ...prev, [id]: el.getURL?.() || prev[id] }));
      };
      const onUrlChanged = () => {
        const url: string = el.getURL?.() || '';
        if (url) setDisplayUrls(prev => ({ ...prev, [id]: url }));
      };

      el.addEventListener('did-start-loading', onNavStart);
      el.addEventListener('did-stop-loading', onNavStop);
      el.addEventListener('did-navigate', onUrlChanged);
      el.addEventListener('did-navigate-in-page', onUrlChanged);

      return () => {
        el.removeEventListener('did-start-loading', onNavStart);
        el.removeEventListener('did-stop-loading', onNavStop);
        el.removeEventListener('did-navigate', onUrlChanged);
        el.removeEventListener('did-navigate-in-page', onUrlChanged);
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goBack = () => wv(active)?.goBack?.();
  const goForward = () => wv(active)?.goForward?.();
  const reload = () => wv(active)?.reload?.();
  const goHome = () => {
    const el = wv(active);
    if (el) el.src = homeUrl(active);
  };

  const navigateToUrl = (url: string) => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    const el = wv(active);
    if (el) el.src = target;
    setEditingUrl(false);
  };

  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') navigateToUrl(editUrl);
    if (e.key === 'Escape') setEditingUrl(false);
  };

  const activeService = SERVICES.find(s => s.id === active)!;

  return (
    <div className="web-services-panel">
      {/* Service tab bar */}
      <div className="web-services-tabs">
        {SERVICES.map(svc => (
          <button
            key={svc.id}
            className={`web-service-tab${active === svc.id ? ' active' : ''}`}
            onClick={() => activateTab(svc.id)}
            title={`Open ${svc.label}`}
            style={{ '--svc-color': svc.color } as React.CSSProperties}
          >
            <span className="tab-icon">{svc.icon}</span>
            <span className="tab-label">{svc.label}</span>
          </button>
        ))}
      </div>

      {/* Navigation bar */}
      <div className="web-nav-bar">
        <button className="web-nav-btn" onClick={goBack}  title="Back">‹</button>
        <button className="web-nav-btn" onClick={goForward} title="Forward">›</button>
        <button className="web-nav-btn" onClick={reload}  title="Reload">↺</button>
        <button className="web-nav-btn" onClick={goHome}  title={`Go to ${activeService.label}`}>⌂</button>

        {/* URL bar */}
        {editingUrl ? (
          <input
            className="web-url-input editing"
            value={editUrl}
            autoFocus
            onChange={e => setEditUrl(e.target.value)}
            onKeyDown={handleNavKeyDown}
            onBlur={() => setEditingUrl(false)}
          />
        ) : (
          <div
            className="web-url-display"
            onClick={() => { setEditUrl(displayUrls[active]); setEditingUrl(true); }}
            title="Click to navigate"
          >
            <span className="url-lock">🔒</span>
            <span className="url-text">{displayUrls[active]}</span>
          </div>
        )}

        {loading[active] && <div className="web-loading-dot" title="Loading…" />}
      </div>

      {/* Hint bar: shown when user hasn't logged in yet */}
      <div className="web-hint-bar">
        <span>
          Log in with your regular <strong>{activeService.label}</strong> account — your session is saved locally and never leaves your device.
        </span>
      </div>

      {/* Webview container — all three are mounted, only active is visible */}
      <div className="web-views-container">
        {SERVICES.map(svc => (
          <div
            key={svc.id}
            className={`web-view-wrapper${active === svc.id ? ' visible' : ''}`}
          >
            {loaded.has(svc.id) && (
              <webview
                ref={(el: HTMLElement | null) => { webviewRefs.current[svc.id] = el; }}
                src={svc.url}
                partition={`persist:${svc.id}`}
                useragent={CHROME_UA}
                allowpopups={true}
                preload={webviewPreload}
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WebServicesPanel;
