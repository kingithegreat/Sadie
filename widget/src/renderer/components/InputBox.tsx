import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAttachment, DocumentAttachment } from '../../shared/types';
import { IMAGE_LIMITS } from '../../shared/constants';
import { resizeImageFile } from '../utils/imageUtils';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: Event & { error: string }) => void;
  onend: () => void;
  onstart: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
    homebotWhisperPipeline: any;
  }
}

// Offline speech recognition uses Windows SAPI via PowerShell (fully offline,
// no external dependencies). Web Speech API is the fallback for non-Windows.

export type InputBoxProps = {
  onSendMessage: (content: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  disabled?: boolean;
};

const PLACEHOLDER_HINTS = [
  'Message HomeBot...',
  'Try: "What\'s the weather?"',
  'Try: "Summarize my clipboard"',
  'Try: "What\'s in the news?"',
  'Try: "Search the web for..."',
  'Try: "Read this file..."',
  'Drop a PDF here to chat about it',
];

export function InputBox({ onSendMessage, disabled: _disabled }: InputBoxProps) {
  type LocalImage = ImageAttachment & { id: string };
  type LocalDocument = DocumentAttachment & { id: string };
  const [inputValue, setInputValue] = useState('');
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [attachedImages, setAttachedImages] = useState<LocalImage[]>([]);
  const [attachedDocuments, setAttachedDocuments] = useState<LocalDocument[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceAutoSend, setVoiceAutoSend] = useState(false);
  const [listenTimer, setListenTimer] = useState(0);
  const listenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceAutoSendPending = useRef(false);
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [ragStatus, setRagStatus] = useState<null | 'indexing' | { ok: boolean; message: string }>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Rotate placeholder hints every 5 seconds when input is empty
  useEffect(() => {
    if (inputValue) return;
    const id = setInterval(() => setPlaceholderIndex(i => (i + 1) % PLACEHOLDER_HINTS.length), 5000);
    return () => clearInterval(id);
  }, [inputValue]);

  // Sync uncensored mode from main process and listen for toggle events
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
    const handler = (e: Event) => setUncensoredMode((e as CustomEvent<boolean>).detail);
    window.addEventListener('homebot:uncensored-mode-changed', handler);
    return () => window.removeEventListener('homebot:uncensored-mode-changed', handler);
  }, []);

  // Check for speech recognition support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    // Also show the mic button when running inside Electron — Windows SAPI is available there
    const hasSapi = typeof (window as any).electron?.startSpeechRecognition === 'function';
    setSpeechSupported(!!(SpeechRecognition || hasSapi));
  }, []);

  // Recording timer — shows elapsed seconds while listening
  useEffect(() => {
    if (isListening) {
      setListenTimer(0);
      listenTimerRef.current = setInterval(() => setListenTimer(t => t + 1), 1000);
    } else {
      if (listenTimerRef.current) { clearInterval(listenTimerRef.current); listenTimerRef.current = null; }
      setListenTimer(0);
    }
    return () => { if (listenTimerRef.current) clearInterval(listenTimerRef.current); };
  }, [isListening]);

  // Auto-dismiss voice error messages after 4 seconds
  useEffect(() => {
    if (errorMessage && errorMessage !== '🎤 Listening… speak now') {
      const t = setTimeout(() => setErrorMessage(null), 4000);
      return () => clearTimeout(t);
    }
  }, [errorMessage]);

  // Initialize speech recognition (online mode - requires internet)
  const startListening = useCallback(async () => {
    // First try Windows SAPI (offline, works reliably in Electron)
    if ((window as any).electron?.startSpeechRecognition) {
      setIsListening(true);
      setErrorMessage('🎤 Listening… speak now');
      
      try {
        const result = await (window as any).electron.startSpeechRecognition();
        setIsListening(false);
        
        if (result.success && result.text) {
          setInputValue(prev => prev + (prev ? ' ' : '') + result.text);
          setErrorMessage(null);
          if (voiceAutoSend) voiceAutoSendPending.current = true;
        } else if (result.success && !result.text) {
          setErrorMessage('No speech detected — try speaking louder or check your microphone.');
        } else {
          setErrorMessage('Voice error: ' + (result.error || 'Speech recognition failed'));
        }
      } catch (err: any) {
        console.error('[Voice] Error:', err);
        setIsListening(false);
        setErrorMessage('Voice error: ' + (err.message || String(err)));
      }
      return;
    }

    // Fallback to Web Speech API (requires internet / Chromium speech service)
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMessage('Speech recognition not supported in this browser.');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setErrorMessage(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        }
      }

      if (finalTranscript) {
        setInputValue(prev => prev + (prev ? ' ' : '') + finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      
      // Handle specific errors
      switch (event.error) {
        case 'network':
          setErrorMessage('Voice input requires internet connection. Please check your network and try again.');
          break;
        case 'not-allowed':
        case 'permission-denied':
          setErrorMessage('Microphone access denied. Please allow in browser/system settings.');
          break;
        case 'no-speech':
          // Silent - just means user didn't speak, no error needed
          break;
        case 'aborted':
          // User cancelled - no error needed
          break;
        default:
          setErrorMessage(`Voice error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [voiceAutoSend]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const ragInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const { MAX_IMAGES, MAX_PER_IMAGE_BYTES: MAX_PER_IMAGE, MAX_TOTAL_BYTES: MAX_TOTAL } = IMAGE_LIMITS;
  const MAX_DOCUMENTS = 3;
  const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB per document

  const validateImages = (images: ImageAttachment[]): string | null => {
    const total = images.reduce((s, img) => s + (img.size || 0), 0);
    if (images.length > MAX_IMAGES) return `You can attach up to ${MAX_IMAGES} images.`;
    if (images.some((img) => (img.size || 0) > MAX_PER_IMAGE)) return `Each image must be <= ${MAX_PER_IMAGE / (1024 * 1024)} MB.`;
    if (total > MAX_TOTAL) return `Total attachments must be <= ${MAX_TOTAL / (1024 * 1024)} MB.`;
    return null;
  };

  const validateDocuments = (docs: DocumentAttachment[]): string | null => {
    if (docs.length > MAX_DOCUMENTS) return `You can attach up to ${MAX_DOCUMENTS} documents.`;
    if (docs.some((doc) => doc.size > MAX_DOC_SIZE)) return `Each document must be <= ${MAX_DOC_SIZE / (1024 * 1024)} MB.`;
    return null;
  };

  useEffect(() => {
    return () => {
      // cleanup object URLs
      attachedImages.forEach((img) => { if (img.url) URL.revokeObjectURL(img.url); });
    };
  }, [attachedImages]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed && attachedImages.length === 0 && attachedDocuments.length === 0) return;

    const imgError = validateImages(attachedImages);
    if (imgError) {
      setErrorMessage(imgError);
      return;
    }

    const docError = validateDocuments(attachedDocuments);
    if (docError) {
      setErrorMessage(docError);
      return;
    }

    onSendMessage(
      trimmed, 
      attachedImages.length ? attachedImages : undefined,
      attachedDocuments.length ? attachedDocuments : undefined
    );

    // reset
    attachedImages.forEach((img) => { if (img.url) URL.revokeObjectURL(img.url); });
    setAttachedImages([]);
    setAttachedDocuments([]);
    setInputValue('');
    setErrorMessage(null);
  }, [inputValue, attachedImages, attachedDocuments, onSendMessage]);

  // Voice auto-send: trigger handleSend once the input value updates after voice recognition
  useEffect(() => {
    if (voiceAutoSendPending.current && inputValue.trim()) {
      voiceAutoSendPending.current = false;
      // Small delay to let state settle
      const t = setTimeout(() => handleSend(), 100);
      return () => clearTimeout(t);
    }
  }, [inputValue, handleSend]);

  // Keyboard shortcut: Ctrl+Shift+V toggles voice input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        if (speechSupported) toggleVoiceInput();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [speechSupported, toggleVoiceInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    let total = attachedImages.reduce((s, img) => s + (img.size || 0), 0);
    const newImages: LocalImage[] = [];

    for (const file of incoming) {
      if (attachedImages.length + newImages.length >= MAX_IMAGES) {
        setErrorMessage(`You can attach up to ${MAX_IMAGES} images.`);
        break;
      }

      try {
        const resized = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
        const size = resized.size || file.size || 0;
        if (size > MAX_PER_IMAGE) {
          setErrorMessage(`Image ${file.name} exceeds per-image limit.`);
          continue;
        }
        if (total + size > MAX_TOTAL) { setErrorMessage(`Adding ${file.name} would exceed total size limit.`); break; }
        total += size;
        const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        const url = resized.url || URL.createObjectURL(file);
        newImages.push({ ...resized, filename: resized.filename ?? file.name, mimeType: resized.mimeType ?? file.type, size, url, id } as LocalImage);
      } catch {
        // fallback -> make a dataURL
        try {
          const readerResult = await new Promise<string>((resolve, reject) => {
            const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsDataURL(file);
          });
          const size = file.size || 0;
          if (size > MAX_PER_IMAGE) { setErrorMessage(`Image ${file.name} exceeds per-image limit.`); continue; }
          if (total + size > MAX_TOTAL) { setErrorMessage(`Adding ${file.name} would exceed total size limit.`); break; }
          total += size; const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const [prefix, base64Part] = readerResult.split(',');
          const data = base64Part || '';
          const mimeType = prefix?.match(/data:(.*);base64/)?.[1] || file.type;
          newImages.push({ filename: file.name, mimeType, data, url: readerResult, size, id } as LocalImage);
        } catch { continue; }
      }
    }

    if (newImages.length) { setAttachedImages((prev) => [...prev, ...newImages]); setErrorMessage(null); }
  };

  // Supported document types
  const DOCUMENT_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'text/plain',
    'text/markdown',
    'application/json',
    'text/csv'
  ];
  const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.csv'];

  const isDocumentFile = (file: File): boolean => {
    if (DOCUMENT_TYPES.includes(file.type)) return true;
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    return DOCUMENT_EXTENSIONS.includes(ext);
  };

  const processDocuments = async (files: File[]) => {
    const newDocs: LocalDocument[] = [];

    for (const file of files) {
      if (attachedDocuments.length + newDocs.length >= MAX_DOCUMENTS) {
        setErrorMessage(`You can attach up to ${MAX_DOCUMENTS} documents.`);
        break;
      }

      if (file.size > MAX_DOC_SIZE) {
        setErrorMessage(`Document ${file.name} exceeds ${MAX_DOC_SIZE / (1024 * 1024)} MB limit.`);
        continue;
      }

      try {
        // Read file as base64
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Extract base64 part from data URL
            const base64 = result.split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const id = `doc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        newDocs.push({
          id,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data
        });
      } catch (err) {
        console.error('Error reading document:', err);
        setErrorMessage(`Failed to read ${file.name}`);
      }
    }

    if (newDocs.length) {
      setAttachedDocuments((prev) => [...prev, ...newDocs]);
      setErrorMessage(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (files) await processFiles(files); if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDocChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      await processDocuments(Array.from(files));
    }
    if (docInputRef.current) docInputRef.current.value = '';
  };

  const handleAttachClick = () => fileInputRef.current?.click();
  const handleDocAttachClick = () => docInputRef.current?.click();

  const handleRagIndex = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const file = files[0];
    // In Electron, File objects have a .path property with the OS path
    const osPath: string = (file as any).path || '';
    if (!osPath) {
      setRagStatus({ ok: false, message: 'RAG indexing requires the desktop app (file path unavailable in browser).' });
      setTimeout(() => setRagStatus(null), 4000);
      return;
    }
    setRagStatus('indexing');
    try {
      const result = await (window as any).electron?.ragIndex?.(osPath);
      if (result?.success) {
        const { filename, chunks_indexed } = result.result || {};
        setRagStatus({ ok: true, message: `✅ Indexed “${filename || file.name}” (${chunks_indexed ?? '?'} chunks) — ask me anything about it!` });
      } else {
        setRagStatus({ ok: false, message: `❌ RAG index failed: ${result?.error || 'unknown error'}` });
      }
    } catch (err: any) {
      setRagStatus({ ok: false, message: `❌ RAG index error: ${err?.message || String(err)}` });
    }
    setTimeout(() => setRagStatus(null), 6000);
  }, []);

  const handleRagFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) await handleRagIndex(Array.from(files));
    if (ragInputRef.current) ragInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const looksLikeRagFile = (file: File): boolean => {
    const ext = ('.' + file.name.split('.').pop()?.toLowerCase()) as string;
    return ['.pdf', '.docx', '.doc', '.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.xml', '.yaml', '.yml', '.log', '.ini', '.toml', '.sh', '.ps1', '.bat'].includes(ext);
  };

  const handleDrop = async (e: React.DragEvent) => { 
    e.preventDefault(); 
    e.stopPropagation(); 
    setIsDragging(false); 
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const docFiles = files.filter(f => isDocumentFile(f) && !f.type.startsWith('image/'));
    const ragFiles = files.filter(f => !f.type.startsWith('image/') && !isDocumentFile(f) && looksLikeRagFile(f));
    if (imageFiles.length) await processFiles(imageFiles);
    if (docFiles.length) {
      await processDocuments(docFiles);
      // Also index document files into RAG for future queries
      const ragEligible = docFiles.filter(f => (f as any).path);
      if (ragEligible.length) handleRagIndex(ragEligible).catch(() => {});
    }
    // Index non-image, non-chat-document files into RAG automatically
    if (ragFiles.length) await handleRagIndex(ragFiles);
  };

  const removeAttachment = (id: string) => {
    setAttachedImages((prev) => { const target = prev.find((img) => img.id === id); if (target?.url) URL.revokeObjectURL(target.url); return prev.filter((img) => img.id !== id); });
    setErrorMessage(null);
  };

  const removeDocument = (id: string) => {
    setAttachedDocuments((prev) => prev.filter((doc) => doc.id !== id));
    setErrorMessage(null);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items; if (!items) return; const files: File[] = [];
    for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.kind === 'file') { const file = it.getAsFile(); if (file) files.push(file); } }
    if (files.length) { 
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      const docFiles = files.filter(f => isDocumentFile(f) && !f.type.startsWith('image/'));
      if (imageFiles.length) await processFiles(imageFiles);
      if (docFiles.length) await processDocuments(docFiles);
      e.preventDefault(); 
    }
  };

  return (
    <div ref={dropRef} className={`input-box ${isDragging ? 'dragging' : ''} ${uncensoredMode ? 'uncensored' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite"><div className="drop-inner">📥 Drop files to attach</div></div>
      )}

      <div className="input-top">
        <textarea className="input-field" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder={PLACEHOLDER_HINTS[placeholderIndex]} rows={2} aria-label="Message HomeBot" maxLength={4000} />
        <div className={`char-counter${inputValue.length > 3000 ? (inputValue.length > 3800 ? ' danger' : ' warning') : ''}`}>{inputValue.length} / 4000</div>

        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden-file-input" aria-label="Attach images" onChange={handleFileChange} />
          <input ref={docInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md,.json,.csv" multiple className="hidden-file-input" aria-label="Attach documents" onChange={handleDocChange} />
          <input ref={ragInputRef} type="file" accept="*" className="hidden-file-input" aria-label="Index file for RAG" onChange={handleRagFileChange} />
          <button className="attach-button" title="Attach images" onClick={handleAttachClick}>📷</button>
          <button className="attach-button" title="Attach documents (PDF, Word, Text)" onClick={handleDocAttachClick}>📄</button>
          <button
            className="attach-button rag-index-button"
            title="Index file for RAG — ask questions about any document"
            onClick={() => ragInputRef.current?.click()}
            disabled={ragStatus === 'indexing'}
          >{ragStatus === 'indexing' ? '⏳' : '📎'}</button>
          {speechSupported && (
            <>
              <button 
                className={`voice-button ${isListening ? 'listening voice-btn-active voice-pulse' : 'voice-btn-idle'}`} 
                title={isListening ? `Stop listening (${listenTimer}s) — Ctrl+Shift+V` : 'Voice input — Ctrl+Shift+V'} 
                onClick={toggleVoiceInput}
              >
                {isListening ? `🎤 ${listenTimer}s` : '🎤'}
              </button>
              <button
                className={`attach-button ${voiceAutoSend ? 'voice-auto-active' : ''}`}
                title={voiceAutoSend ? 'Auto-send after voice: ON' : 'Auto-send after voice: OFF'}
                onClick={() => setVoiceAutoSend(v => !v)}
                style={{ fontSize: '11px', padding: '2px 4px', minWidth: 0 }}
              >
                {voiceAutoSend ? '⚡' : '⏸'}
              </button>
            </>
          )}
          <button className="send-button" onClick={handleSend} disabled={!inputValue.trim() && attachedImages.length === 0 && attachedDocuments.length === 0}>Send</button>
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div className="image-preview-gallery">
          {attachedImages.map((img) => (
            <div key={img.id} className="image-preview" title={img.filename ?? 'image'}>
              {img.url && <img src={img.url} alt={img.filename} className="image-thumb" />}
              <button className="remove-image" onClick={() => removeAttachment(img.id)} title="Remove image" aria-label={`Remove ${img.filename}`}>✕</button>
            </div>
          ))}
        </div>
      )}

      {attachedDocuments.length > 0 && (
        <div className="document-preview-gallery">
          {attachedDocuments.map((doc) => (
            <div key={doc.id} className="document-preview">
              <span className="document-icon">
                {doc.filename.endsWith('.pdf') ? '📕' : 
                 doc.filename.endsWith('.docx') || doc.filename.endsWith('.doc') ? '📘' : 
                 '📄'}
              </span>
              <div className="document-meta">
                <div className="document-filename">{doc.filename}</div>
                <div className="document-size">{(doc.size / 1024).toFixed(1)} KB</div>
              </div>
              <button className="remove-document" onClick={() => removeDocument(doc.id)} title="Remove document">✕</button>
            </div>
          ))}
        </div>
      )}

      {ragStatus && ragStatus !== 'indexing' && (
        <div
          role="status"
          className={`rag-status-banner ${ragStatus.ok ? 'rag-status-ok' : 'rag-status-err'}`}
        >
          {ragStatus.message}
        </div>
      )}

      {errorMessage && <div role="alert" className="image-error input-error-msg">{errorMessage}</div>}
    </div>
  );
}

export default InputBox;


