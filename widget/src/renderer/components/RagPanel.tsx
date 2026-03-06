import React, { useEffect, useState, useCallback } from 'react';

interface RagDoc {
  doc_id: string;
  filename: string;
  chunk_count: number;
}

interface RagPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const RagPanel: React.FC<RagPanelProps> = ({ isOpen, onClose }) => {
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await window.electron.ragList?.();
      if (resp?.success && resp.result) {
        setDocs(resp.result.documents ?? []);
        setTotalChunks(resp.result.total_chunks ?? 0);
      } else {
        setDocs([]);
        setTotalChunks(0);
        if (resp?.error) setError(resp.error);
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadDocs();
  }, [isOpen, loadDocs]);

  const handleRemove = async (docId: string) => {
    setRemoving(docId);
    try {
      const resp = await window.electron.ragClear?.(docId);
      if (resp?.success) {
        setDocs(prev => prev.filter(d => d.doc_id !== docId));
        setTotalChunks(prev => {
          const removed = resp.result?.removed_chunks ?? 0;
          return Math.max(0, prev - removed);
        });
      } else {
        setError(resp?.error ?? 'Failed to remove document');
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setRemoving(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="rag-panel-overlay" onClick={onClose}>
      <div
        className="rag-panel"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="RAG index panel"
      >
        <div className="rag-panel-header">
          <span>📚 RAG Index</span>
          <button className="rag-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rag-panel-meta">
          {loading
            ? 'Loading…'
            : `${docs.length} document${docs.length !== 1 ? 's' : ''} · ${totalChunks} chunk${totalChunks !== 1 ? 's' : ''}`
          }
        </div>

        {error && (
          <div className="rag-panel-error">{error}</div>
        )}

        {!loading && docs.length === 0 && !error && (
          <div className="rag-panel-empty">
            No documents indexed yet.<br />
            Drag &amp; drop a file onto the chat to index it.
          </div>
        )}

        <ul className="rag-doc-list">
          {docs.map(doc => (
            <li key={doc.doc_id} className="rag-doc-item">
              <div className="rag-doc-info">
                <span className="rag-doc-name" title={doc.doc_id}>{doc.filename}</span>
                <span className="rag-doc-chunks">{doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}</span>
              </div>
              <button
                className="rag-doc-remove"
                title="Remove from index"
                aria-label={`Remove ${doc.filename}`}
                disabled={removing === doc.doc_id}
                onClick={() => handleRemove(doc.doc_id)}
              >
                {removing === doc.doc_id ? '…' : '✕'}
              </button>
            </li>
          ))}
        </ul>

        <div className="rag-panel-footer">
          <button className="rag-panel-refresh" onClick={loadDocs} disabled={loading}>
            ↻ Refresh
          </button>
        </div>

        <style>{`
          .rag-panel-overlay {
            position: fixed;
            inset: 0;
            z-index: 900;
            background: rgba(0,0,0,0.4);
            display: flex;
            align-items: flex-start;
            justify-content: flex-end;
            padding: 56px 12px 0 0;
          }
          .rag-panel {
            background: #1a1a1a;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            width: 320px;
            max-height: 60vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            overflow: hidden;
          }
          .rag-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            font-weight: 600;
            font-size: 13px;
            color: #eee;
          }
          .rag-panel-close {
            border: none;
            background: transparent;
            color: #888;
            cursor: pointer;
            font-size: 14px;
            padding: 2px 6px;
            border-radius: 4px;
          }
          .rag-panel-close:hover { background: rgba(255,255,255,0.08); color: #ddd; }
          .rag-panel-meta {
            font-size: 11px;
            color: #666;
            padding: 6px 14px 4px;
          }
          .rag-panel-error {
            font-size: 11px;
            color: #ff3b30;
            padding: 4px 14px;
          }
          .rag-panel-empty {
            font-size: 12px;
            color: #666;
            padding: 20px 14px;
            text-align: center;
            line-height: 1.6;
          }
          .rag-doc-list {
            list-style: none;
            margin: 0;
            padding: 4px 0;
            overflow-y: auto;
            flex: 1;
          }
          .rag-doc-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
          }
          .rag-doc-item:hover { background: rgba(255,255,255,0.03); }
          .rag-doc-info {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            flex: 1;
          }
          .rag-doc-name {
            font-size: 12px;
            color: #ddd;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .rag-doc-chunks {
            font-size: 10px;
            color: #666;
          }
          .rag-doc-remove {
            border: none;
            background: transparent;
            color: #666;
            cursor: pointer;
            font-size: 12px;
            padding: 3px 7px;
            border-radius: 4px;
            flex-shrink: 0;
            margin-left: 8px;
          }
          .rag-doc-remove:hover:not(:disabled) { background: rgba(255,59,48,0.15); color: #ff3b30; }
          .rag-doc-remove:disabled { opacity: 0.4; cursor: default; }
          .rag-panel-footer {
            padding: 8px 14px;
            border-top: 1px solid rgba(255,255,255,0.06);
            display: flex;
            justify-content: flex-end;
          }
          .rag-panel-refresh {
            border: 1px solid rgba(255,255,255,0.12);
            background: transparent;
            color: #888;
            cursor: pointer;
            font-size: 11px;
            padding: 4px 10px;
            border-radius: 6px;
          }
          .rag-panel-refresh:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #ddd; }
          .rag-panel-refresh:disabled { opacity: 0.4; cursor: default; }
        `}</style>
      </div>
    </div>
  );
};

export default RagPanel;
