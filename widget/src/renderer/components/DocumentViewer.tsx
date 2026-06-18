import React, { useState, useRef } from 'react';

export interface DocViewerProps {
  onSendToChat?: (filePath: string, content: string) => void;
}

interface DocumentState {
  filePath: string;
  fileName: string;
  content: string;
  htmlContent?: string;
  type: 'text' | 'html' | 'spreadsheet';
  dirty: boolean;
}

const SUPPORTED_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.log',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs',
  '.pdf', '.docx', '.xlsx', '.xls',
  '.sh', '.bash', '.ps1', '.bat', '.sql', '.html', '.css',
];

const DocumentViewer: React.FC<DocViewerProps> = ({ onSendToChat }) => {
  const [doc, setDoc] = useState<DocumentState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [ragStatus, setRagStatus] = useState<'idle' | 'indexing' | 'done' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const openFile = async (filePath: string) => {
    setLoading(true);
    setError(null);
    setSaveMsg(null);
    try {
      const result = await window.electron.parseDocument?.(filePath);

      if (!result || !result.success) {
        setError(result?.error || 'Failed to open file');
        setLoading(false);
        return;
      }

      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const fileName = result.fileName || filePath.split(/[\\/]/).pop() || filePath;

      let type: DocumentState['type'] = 'text';
      let content = '';
      let htmlContent: string | undefined;

      if (result.html) {
        type = 'html';
        htmlContent = result.html;
        content = result.text || '';
      } else if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || result.type === 'spreadsheet') {
        type = 'spreadsheet';
        content = result.text || '';
      } else {
        type = 'text';
        content = result.text || '';
      }

      setDoc({ filePath, fileName, content, htmlContent, type, dirty: false });
    } catch (err: any) {
      setError(err.message || 'Failed to open file');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = (file as any).path;
    if (filePath) {
      await openFile(filePath);
    } else {
      setError('Could not determine file path');
    }
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const filePath = (file as any).path;
    if (filePath) {
      await openFile(filePath);
    }
  };

  const handleContentChange = (newContent: string) => {
    if (!doc) return;
    setDoc({ ...doc, content: newContent, dirty: true });
    setSaveMsg(null);
  };

  const handleSave = async () => {
    if (!doc || !doc.dirty) return;
    setSaving(true);
    setError(null);
    try {
      const result = await window.electron.writeDocument?.(doc.filePath, doc.content);
      if (result?.success) {
        setDoc({ ...doc, dirty: false });
        setSaveMsg('Saved');
        setTimeout(() => setSaveMsg(null), 2000);
      } else {
        setError(result?.error || 'Failed to save');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAs = async (format: 'docx' | 'pdf' | 'txt') => {
    if (!doc) return;
    setSaving(true);
    setError(null);
    try {
      const baseName = doc.fileName.replace(/\.[^.]+$/, '');
      const home = await window.electron.getEnv?.();
      const desktopBase = 'Desktop';
      const targetPath = `${desktopBase}/${baseName}.${format}`;

      if (format === 'txt') {
        const absPath = `${(home as any)?.userDataPath ? '' : ''}~/Desktop/${baseName}.txt`;
        const result = await window.electron.writeDocument?.(absPath, doc.content);
        if (result?.success) {
          setSaveMsg('Exported as TXT to Desktop');
        } else {
          setError(result?.error || 'Failed to export');
        }
      } else {
        // Use chat to invoke create_docx / create_pdf tool
        const result = await window.electron.sendMessage({
          user_id: 'local',
          message: `Create a ${format} file at "${targetPath}" with the title "${baseName}" and the following content:\n\n${doc.content.slice(0, 8000)}`,
          conversation_id: '__doc_export__',
        });
        if (result.success || result.response) {
          setSaveMsg(`Exported as ${format.toUpperCase()} to Desktop`);
        } else {
          setError(result.message || `Failed to export as ${format}`);
        }
      }
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddToRag = async () => {
    if (!doc) return;
    setRagStatus('indexing');
    try {
      const result = await (window as any).electron?.ragIndex?.(doc.filePath);
      if (result?.success) {
        const chunks = result.result?.chunks_indexed ?? 0;
        setRagStatus('done');
        setSaveMsg(`Indexed into RAG (${chunks} chunks)`);
        setTimeout(() => { setSaveMsg(null); setRagStatus('idle'); }, 3000);
      } else {
        setRagStatus('error');
        setError(result?.error || 'Failed to index document');
        setTimeout(() => setRagStatus('idle'), 3000);
      }
    } catch (err: any) {
      setRagStatus('error');
      setError(err.message || 'RAG indexing failed');
      setTimeout(() => setRagStatus('idle'), 3000);
    }
  };

  const handleSendToChat = () => {
    if (!doc) return;
    if (onSendToChat) {
      onSendToChat(doc.filePath, doc.content);
    }
  };

  const renderSpreadsheet = (content: string) => {
    const sections = content.split(/^## Sheet: /m).filter(Boolean);
    return sections.map((section, si) => {
      const lines = section.split('\n');
      const sheetName = lines[0]?.trim() || `Sheet ${si + 1}`;
      const rows = lines.slice(1).filter(l => l.trim());
      return (
        <div key={si} className="doc-sheet">
          <h3 className="doc-sheet-name">{sheetName}</h3>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.split('\t').map((cell, ci) => (
                      ri === 0
                        ? <th key={ci}>{cell}</th>
                        : <td key={ci}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    });
  };

  return (
    <div
      className="document-viewer"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="doc-header">
        <h1>Document Viewer</h1>
        <div className="doc-actions">
          <button className="doc-btn doc-btn-primary" onClick={handleFileSelect}>
            Open File
          </button>
          {doc && doc.type === 'text' && doc.dirty && (
            <button className="doc-btn" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {doc && (
            <>
              <button className="doc-btn" onClick={() => handleSaveAs('docx')} disabled={saving}>
                Export DOCX
              </button>
              <button className="doc-btn" onClick={() => handleSaveAs('pdf')} disabled={saving}>
                Export PDF
              </button>
              <button className="doc-btn" onClick={() => handleSaveAs('txt')} disabled={saving}>
                Export TXT
              </button>
              <button
                className="doc-btn doc-btn-rag"
                onClick={handleAddToRag}
                disabled={ragStatus === 'indexing'}
                title="Index this document for semantic search (RAG)"
              >
                {ragStatus === 'indexing' ? 'Indexing...' : ragStatus === 'done' ? 'Indexed' : 'Add to RAG'}
              </button>
              {onSendToChat && (
                <button
                  className="doc-btn doc-btn-chat"
                  onClick={handleSendToChat}
                  title="Send this document to chat as context"
                >
                  Send to Chat
                </button>
              )}
            </>
          )}
          {doc && (
            <button className="doc-btn doc-btn-close" onClick={() => { setDoc(null); setError(null); setSaveMsg(null); setRagStatus('idle'); }}>
              Close
            </button>
          )}
        </div>
      </header>

      {error && <div className="doc-error">{error}</div>}
      {saveMsg && <div className="doc-save-msg">{saveMsg}</div>}

      {doc && (
        <div className="doc-info-bar">
          <span className="doc-filename">{doc.fileName}</span>
          <span className="doc-filepath">{doc.filePath}</span>
          {doc.dirty && <span className="doc-dirty-badge">unsaved</span>}
        </div>
      )}

      {loading ? (
        <div className="doc-loading">Opening document...</div>
      ) : !doc ? (
        <div className="doc-empty">
          <div className="doc-drop-zone">
            <p>Drop a file here or click Open File</p>
            <p className="doc-formats">Supports: PDF, Word, Excel, CSV, Markdown, code files, and more</p>
          </div>
        </div>
      ) : doc.type === 'html' && doc.htmlContent ? (
        <div className="doc-content doc-html" dangerouslySetInnerHTML={{ __html: doc.htmlContent }} />
      ) : doc.type === 'spreadsheet' ? (
        <div className="doc-content doc-spreadsheet">
          {renderSpreadsheet(doc.content)}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="doc-content doc-editor"
          value={doc.content}
          onChange={e => handleContentChange(e.target.value)}
          spellCheck={false}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        accept={SUPPORTED_EXTENSIONS.join(',')}
        onChange={handleFileInputChange}
      />

      <style>{`
        .document-viewer {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-primary, #1a1a2e);
          color: var(--text-primary, #e0e0e0);
          overflow: hidden;
        }
        .doc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.08));
          flex-shrink: 0;
        }
        .doc-header h1 {
          font-size: 16px;
          margin: 0;
          font-weight: 600;
        }
        .doc-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .doc-btn {
          padding: 5px 12px;
          border-radius: 6px;
          border: 1px solid var(--border-color, rgba(255,255,255,0.12));
          background: var(--bg-secondary, #16213e);
          color: var(--text-primary, #e0e0e0);
          cursor: pointer;
          font-size: 12px;
          transition: background 0.15s;
        }
        .doc-btn:hover { background: var(--bg-hover, #1a1a4e); }
        .doc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .doc-btn-primary {
          background: var(--accent-primary, #4a6cf7);
          color: #fff;
          border-color: transparent;
        }
        .doc-btn-primary:hover { background: var(--accent-hover, #3b5de7); }
        .doc-btn-close { color: #f87171; border-color: #f8717140; }
        .doc-btn-rag {
          background: #7c3aed20;
          color: #a78bfa;
          border-color: #a78bfa40;
        }
        .doc-btn-rag:hover { background: #7c3aed40; }
        .doc-btn-chat {
          background: #2563eb20;
          color: #60a5fa;
          border-color: #60a5fa40;
        }
        .doc-btn-chat:hover { background: #2563eb40; }
        .doc-error {
          padding: 8px 16px;
          background: #f8717120;
          color: #f87171;
          font-size: 13px;
          flex-shrink: 0;
        }
        .doc-save-msg {
          padding: 8px 16px;
          background: #34d39920;
          color: #34d399;
          font-size: 13px;
          flex-shrink: 0;
        }
        .doc-info-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 16px;
          font-size: 12px;
          border-bottom: 1px solid var(--border-color, rgba(255,255,255,0.06));
          flex-shrink: 0;
          color: var(--text-secondary, #888);
        }
        .doc-filename { font-weight: 600; color: var(--text-primary, #e0e0e0); }
        .doc-filepath { opacity: 0.6; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .doc-dirty-badge {
          background: #f59e0b30;
          color: #f59e0b;
          padding: 1px 8px;
          border-radius: 4px;
          font-size: 11px;
        }
        .doc-loading {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary, #888);
        }
        .doc-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .doc-drop-zone {
          text-align: center;
          padding: 48px;
          border: 2px dashed var(--border-color, rgba(255,255,255,0.12));
          border-radius: 12px;
          max-width: 400px;
        }
        .doc-drop-zone p { margin: 8px 0; }
        .doc-formats { font-size: 12px; color: var(--text-secondary, #888); }
        .doc-content {
          flex: 1;
          overflow: auto;
          padding: 16px;
        }
        .doc-html {
          font-family: Georgia, 'Times New Roman', serif;
          line-height: 1.7;
          font-size: 14px;
        }
        .doc-html h1, .doc-html h2, .doc-html h3 { color: var(--text-primary, #e0e0e0); }
        .doc-html p { margin: 0.5em 0; }
        .doc-html table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .doc-html th, .doc-html td { border: 1px solid var(--border-color, rgba(255,255,255,0.12)); padding: 6px 10px; text-align: left; }
        .doc-editor {
          width: 100%;
          resize: none;
          border: none;
          outline: none;
          background: transparent;
          color: var(--text-primary, #e0e0e0);
          font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
          font-size: 13px;
          line-height: 1.6;
          tab-size: 2;
        }
        .doc-spreadsheet { padding: 12px; }
        .doc-sheet { margin-bottom: 24px; }
        .doc-sheet-name {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: var(--accent-primary, #4a6cf7);
        }
        .doc-table-wrap { overflow-x: auto; }
        .doc-table {
          border-collapse: collapse;
          font-size: 12px;
          width: 100%;
        }
        .doc-table th, .doc-table td {
          border: 1px solid var(--border-color, rgba(255,255,255,0.12));
          padding: 4px 10px;
          text-align: left;
          white-space: nowrap;
        }
        .doc-table th {
          background: var(--bg-secondary, #16213e);
          font-weight: 600;
          position: sticky;
          top: 0;
        }
        .doc-table tr:hover td { background: rgba(255,255,255,0.03); }
      `}</style>
    </div>
  );
};

export default DocumentViewer;
