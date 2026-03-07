/**
 * WebServicesPanel.tsx
 *
 * Launcher panel for ChatGPT, Claude, and Gemini.
 *
 * Each service opens in its own dedicated BrowserWindow (managed by the main
 * process via web-services.ts). This bypasses all the <webview> detection
 * issues — BrowserWindows have navigator.webdriver=false by default, OAuth
 * popups work natively, and sessions persist across restarts via Electron
 * session partitions (persist:chatgpt etc.).
 */

import React, { useEffect, useState } from 'react';

const SERVICES = [
  { id: 'chatgpt', label: 'ChatGPT', icon: '🤖', desc: 'GPT-4o, o1, image generation', color: '#10a37f', url: 'chatgpt.com' },
  { id: 'claude',  label: 'Claude',  icon: '◆',  desc: 'Claude 3.5 Sonnet & Opus',    color: '#d97706', url: 'claude.ai'  },
  { id: 'gemini',  label: 'Gemini',  icon: '✦',  desc: 'Gemini 1.5 Pro & Ultra',      color: '#4285f4', url: 'gemini.google.com' },
] as const;

type ServiceId = (typeof SERVICES)[number]['id'];
type StatusMap = Record<ServiceId, boolean>;

const ws = (window as any)._webServices as {
  open:   (id: string) => Promise<void>;
  status: ()           => Promise<StatusMap>;
} | undefined;

const WebServicesPanel: React.FC = () => {
  const [open, setOpen] = useState<StatusMap>({ chatgpt: false, claude: false, gemini: false });

  // Poll open-window status every 2 s so the badge updates automatically
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (!ws) return;
      try {
        const s = await ws.status();
        if (alive) setOpen(s);
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const launch = async (id: ServiceId) => {
    if (!ws) return;
    await ws.open(id);
    // Optimistically mark as open
    setOpen(prev => ({ ...prev, [id]: true }));
  };

  return (
    <div className="web-services-panel">
      <div className="web-services-hero">
        <h2 className="web-services-title">Web Services</h2>
        <p className="web-services-subtitle">
          Log in with your existing subscription — sessions persist between restarts.
        </p>
      </div>

      <div className="web-service-cards">
        {SERVICES.map(svc => (
          <div
            key={svc.id}
            className="web-service-card"
            style={{ '--svc-color': svc.color } as React.CSSProperties}
          >
            <div className="wsc-icon">{svc.icon}</div>
            <div className="wsc-info">
              <span className="wsc-name">{svc.label}</span>
              <span className="wsc-desc">{svc.desc}</span>
              <span className="wsc-url">{svc.url}</span>
            </div>
            <div className="wsc-actions">
              {open[svc.id] && <span className="wsc-badge">Open</span>}
              <button
                className="wsc-btn"
                onClick={() => launch(svc.id)}
                title={open[svc.id] ? `Switch to ${svc.label}` : `Open ${svc.label}`}
              >
                {open[svc.id] ? 'Switch to' : 'Open'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="web-services-note">
        Each service opens in its own window with a saved session — no API key needed.
      </p>
    </div>
  );
};

export default WebServicesPanel;
