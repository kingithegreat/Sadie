import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAttachment, DocumentAttachment } from '../../shared/types';
import { IMAGE_LIMITS } from '../../shared/constants';
import { resizeImageFile } from '../utils/imageUtils';
import { ToolPicker } from './ToolPicker';

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
    sadieWhisperPipeline: any;
  }
}

// Offline speech recognition - disabled for now due to Electron compatibility issues
// The @xenova/transformers library has bundling issues in Electron
// TODO: Implement native Whisper.cpp integration for true offline support

const OFFLINE_SUPPORTED = false;

async function transcribeWithWhisper(_audioBlob: Blob, _onStatus?: (msg: string) => void): Promise<string> {
  throw new Error('Offline transcription not yet available. Please connect to the internet for voice input.');
}

export type InputBoxProps = {
  onSendMessage: (content: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  disabled?: boolean;
};

export function InputBox({ onSendMessage, disabled }: InputBoxProps) {
  type LocalImage = ImageAttachment & { id: string };
  type LocalDocument = DocumentAttachment & { id: string };
  const [inputValue, setInputValue] = useState('');
  const [attachedImages, setAttachedImages] = useState<LocalImage[]>([]);
  const [attachedDocuments, setAttachedDocuments] = useState<LocalDocument[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<{ id: string; name: string } | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Check for speech recognition support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(!!SpeechRecognition);
  }, []);

  // Initialize speech recognition (online mode - requires internet)
  const startListening = useCallback(async () => {
    console.log('[Voice] Starting speech recognition...');
    console.log('[Voice] electron object:', (window as any).electron);
    console.log('[Voice] startSpeechRecognition:', (window as any).electron?.startSpeechRecognition);
    
    // First try Windows SAPI (offline, works reliably in Electron)
    if ((window as any).electron?.startSpeechRecognition) {
      console.log('[Voice] Using Windows SAPI...');
      setIsListening(true);
      setErrorMessage('Listening... speak now (10 sec timeout)');
      
      try {
        const result = await (window as any).electron.startSpeechRecognition();
        console.log('[Voice] Result:', result);
        setIsListening(false);
        
        if (result.success && result.text) {
          setInputValue(prev => prev + (prev ? ' ' : '') + result.text);
          setErrorMessage(null);
        } else if (!result.text) {
          setErrorMessage('No speech detected. Try again.');
        } else {
          setErrorMessage(result.error || 'Speech recognition failed');
        }
      } catch (err: any) {
        console.error('[Voice] Error:', err);
        setIsListening(false);
        setErrorMessage('Speech recognition error: ' + (err.message || err));
      }
      return;
    }
    
    console.log('[Voice] Falling back to Web Speech API...');

    // Fallback to Web Speech API (requires internet)
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
  }, []);

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

    // If a tool is selected, prefix the message with a tool instruction
    let finalMessage = trimmed;
    if (selectedTool) {
      finalMessage = `[USE TOOL: ${selectedTool.id}] ${trimmed}`;
    }

    // Debug: log what we're sending
    console.log('[InputBox] Sending message with:', JSON.stringify({
      message: finalMessage.substring(0, 50),
      imageCount: attachedImages.length,
      documentCount: attachedDocuments.length,
      documents: attachedDocuments.map(d => ({ filename: d.filename, size: d.size, hasData: !!d.data }))
    }));

    onSendMessage(
      finalMessage, 
      attachedImages.length ? attachedImages : undefined,
      attachedDocuments.length ? attachedDocuments : undefined
    );

    // reset
    attachedImages.forEach((img) => { if (img.url) URL.revokeObjectURL(img.url); });
    setAttachedImages([]);
    setAttachedDocuments([]);
    setInputValue('');
    setErrorMessage(null);
    setSelectedTool(null);
  }, [inputValue, attachedImages, attachedDocuments, onSendMessage, selectedTool]);

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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = async (e: React.DragEvent) => { 
    e.preventDefault(); 
    e.stopPropagation(); 
    setIsDragging(false); 
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const docFiles = files.filter(f => isDocumentFile(f) && !f.type.startsWith('image/'));
    if (imageFiles.length) await processFiles(imageFiles);
    if (docFiles.length) await processDocuments(docFiles);
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

  // Handler for tool selection
  const handleToolSelect = useCallback((toolId: string, toolName: string) => {
    setSelectedTool({ id: toolId, name: toolName });
    setToolPickerOpen(false);
  }, []);

  return (
    <div ref={dropRef} className={`input-box ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite"><div className="drop-inner">📥 Drop files to attach</div></div>
      )}

      {/* Tool Picker Component */}
      <ToolPicker 
        isOpen={toolPickerOpen} 
        onClose={() => setToolPickerOpen(false)} 
        onSelectTool={handleToolSelect} 
      />

      {/* Selected Tool Indicator */}
      {selectedTool && (
        <div className="selected-tool-indicator">
          <span>🛠️ Using: <strong>{selectedTool.name}</strong></span>
          <button className="clear-tool" onClick={() => setSelectedTool(null)} title="Clear tool selection">✕</button>
        </div>
      )}

      <div className="input-top">
        <textarea className="input-field" data-testid="chat-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Message SADIE..." rows={2} aria-label="Message SADIE" />

        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <input ref={docInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md,.json,.csv" multiple style={{ display: 'none' }} onChange={handleDocChange} />
          <button 
            className={`tool-trigger-btn ${toolPickerOpen ? 'active' : ''}`} 
            title="Select a tool" 
            onClick={() => setToolPickerOpen(!toolPickerOpen)}
          >
            🛠️
          </button>
          <button className="attach-button" title="Attach images" onClick={handleAttachClick}>📷</button>
          <button className="attach-button" title="Attach documents (PDF, Word, Text)" onClick={handleDocAttachClick}>📄</button>
          {speechSupported && (
            <button 
              className={`voice-button ${isListening ? 'listening' : ''}`} 
              title={isListening ? 'Stop listening' : 'Voice input'} 
              onClick={toggleVoiceInput}
              style={{
                background: isListening ? '#ff3b30' : 'transparent',
                animation: isListening ? 'pulse 1.5s infinite' : 'none'
              }}
            >
              🎤
            </button>
          )}
          <button className="send-button" onClick={handleSend} disabled={!inputValue.trim() && attachedImages.length === 0 && attachedDocuments.length === 0}>Send</button>
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div className="image-preview-gallery">
          {attachedImages.map((img) => (
            <div key={img.id} className="image-preview">
              {img.url && <img src={img.url} alt={img.filename} className="image-thumb" />}
              <div className="image-meta">
                <div className="image-filename">{img.filename ?? 'image'}</div>
                <button className="remove-image" onClick={() => removeAttachment(img.id)} title="Remove image">Remove</button>
              </div>
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

      {errorMessage && <div role="alert" className="image-error" style={{ color: '#ff3b30', marginTop: 8 }}>{errorMessage}</div>}
    </div>
  );
}


