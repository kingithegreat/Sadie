/**
 * WebServicesPanel.tsx
 *
 * Two sections:
 *  1. URL Browser — paste a URL, fetch its content, then Summarize to Chat or Add to RAG
 *  2. Service Launchers — ChatGPT, Claude, Gemini in dedicated BrowserWindows
 */

import React, { useEffect, useState } from 'react';

// ── Types ──

export interface WebServicesPanelProps {
  onSendToChat?: (url: string, content: string) => void;
}

// ── Service launcher config ──

const SERVICES = [
  { id: 'chatgpt', label: 'ChatGPT', icon: '🤖', desc: 'GPT-4o, o3, image generation',  color: '#10a37f', url: 'chatgpt.com' },
  { id: 'claude',  label: 'Claude',  icon: '◆',  desc: 'Claude Opus, Sonnet & Haiku', color: '#d97706', url: 'claude.ai'  },
  { id: 'gemini',  label: 'Gemini',  icon: '✦',  desc: 'Gemini 2.5 Pro & Flash',      color: '#4285f4', url: 'gemini.google.com' },
] as const;

type ServiceId = (typeof SERVICES)[number]['id'];
type StatusMap = Record<ServiceId, boolean>;

function getWs() {
  return (window as any)._webServices as {
    open:   (id: string) => Promise<void>;
    status: ()           => Promise<StatusMap>;
  } | undefined;
}

function getElectron() {
  return (window as any).electron as {
    fetchPageContent?: (url: string) => Promise<{ success: boolean; result?: { url: string; content: string; length: number; truncated: boolean }; error?: string }>;
    ragIndex?: (filePath: string) => Promise<{ success: boolean; result?: { chunks_indexed?: number }; error?: string }>;
  } | undefined;
}

// ── Component ──

const WebServicesPanel: React.FC<WebServicesPanelProps> = ({ onSendToChat }) => {
  const [open, setOpen] = useState<StatusMap>({ chatgpt: false, claude: false, gemini: false });
  const [url, setUrl] = useState('');
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle');
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [ragStatus, setRagStatus] = useState<'idle' | 'indexing' | 'done' | 'error'>('idle');

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const ws = getWs();
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
    const ws = getWs();
    if (!ws) return;
    await ws.open(id);
    setOpen(prev => ({ ...prev, [id]: true }));
  };

  const normalizeUrl = (raw: string): string => {
    let u = raw.trim();
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  };

  const handleFetch = async () => {
    const normalized = normalizeUrl(url);
    if (!normalized) return;

    setFetchStatus('fetching');
    setPageContent(null);
    setPageUrl(null);
    setStatusMsg(null);

    try {
      const result = await getElectron()?.fetchPageContent?.(normalized);
      if (result?.success && result.result) {
        setPageContent(result.result.content);
        setPageUrl(result.result.url);
        setFetchStatus('done');
        const chars = result.result.length.toLocaleString();
        setStatusMsg(`Fetched ${chars} characters${result.result.truncated ? ' (truncated)' : ''}`);
      } else {
        setFetchStatus('error');
        setStatusMsg(result?.error || 'Failed to fetch page');
      }
    } catch (err: any) {
      setFetchStatus('error');
      setStatusMsg(err.message || 'Fetch failed');
    }
  };

  const handleSendToChat = () => {
    if (!pageContent || !pageUrl || !onSendToChat) return;
    onSendToChat(pageUrl, pageContent);
  };

  const handleAddToRag = async () => {
    if (!pageContent || !pageUrl) return;
    setRagStatus('indexing');
    try {
      const tmpPath = `web-content://${pageUrl}`;
      const result = await getElectron()?.ragIndex?.(tmpPath);
      if (result?.success) {
        const chunks = result.result?.chunks_indexed ?? 0;
        setRagStatus('done');
        setStatusMsg(`Indexed into RAG (${chunks} chunks)`);
        setTimeout(() => setRagStatus('idle'), 3000);
      } else {
        setRagStatus('error');
        setStatusMsg(result?.error || 'RAG indexing failed');
        setTimeout(() => setRagStatus('idle'), 3000);
      }
    } catch (err: any) {
      setRagStatus('error');
      setStatusMsg(err.message || 'RAG indexing failed');
      setTimeout(() => setRagStatus('idle'), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFetch();
  };

  return (
    <div className="web-services-panel">
      {/* ── URL Browser Section ── */}
      <div className="web-browser-section">
        <h2 className="web-services-title">Web Browser</h2>
        <p className="web-services-subtitle">
          Fetch any web page, then summarize it in chat or add it to RAG for semantic search.
        </p>

        <div className="web-url-bar">
          <input
            type="text"
            className="web-url-input"
            placeholder="Enter a URL (e.g. https://example.com/article)..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="web-fetch-btn"
            onClick={handleFetch}
            disabled={fetchStatus === 'fetching' || !url.trim()}
          >
            {fetchStatus === 'fetching' ? 'Fetching...' : 'Fetch'}
          </button>
        </div>

        {statusMsg && (
          <p className={`web-status-msg ${fetchStatus === 'error' ? 'error' : ''}`}>
            {statusMsg}
          </p>
        )}

        {pageContent && (
          <div className="web-content-preview">
            <div className="web-content-header">
              <span className="web-content-url">{pageUrl}</span>
              <span className="web-content-length">{pageContent.length.toLocaleString()} chars</span>
            </div>
            <div className="web-content-text">
              {pageContent.slice(0, 1500)}
              {pageContent.length > 1500 && <span className="web-content-fade">... (preview truncated)</span>}
            </div>
            <div className="web-content-actions">
              <button
                className="web-action-btn summarize"
                onClick={handleSendToChat}
                disabled={!onSendToChat}
                title="Send page content to chat for AI summarization"
              >
                💬 Summarize in Chat
              </button>
              <button
                className="web-action-btn rag"
                onClick={handleAddToRag}
                disabled={ragStatus === 'indexing'}
                title="Index page content into RAG for semantic search"
              >
                {ragStatus === 'indexing' ? '⏳ Indexing...' : ragStatus === 'done' ? '✓ Indexed' : '🔍 Add to RAG'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <hr className="web-divider" />

      {/* ── Service Launchers ── */}
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
