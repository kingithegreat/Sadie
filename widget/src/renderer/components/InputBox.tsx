import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageAttachment } from '../../shared/types';
import { IMAGE_LIMITS } from '../../shared/constants';
import { resizeImageFile } from '../utils/imageUtils';

export type InputBoxProps = {
  onSendMessage: (content: string, images?: ImageAttachment[] | null) => void;
  disabled?: boolean;
};

export function InputBox({ onSendMessage, disabled }: InputBoxProps) {
  type LocalImage = ImageAttachment & { id: string };
  const [inputValue, setInputValue] = useState('');
  const [attachedImages, setAttachedImages] = useState<LocalImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const { MAX_IMAGES, MAX_PER_IMAGE_BYTES: MAX_PER_IMAGE, MAX_TOTAL_BYTES: MAX_TOTAL } = IMAGE_LIMITS;

  const validateImages = (images: ImageAttachment[]): string | null => {
    const total = images.reduce((s, img) => s + (img.size || 0), 0);
    if (images.length > MAX_IMAGES) return `You can attach up to ${MAX_IMAGES} images.`;
    if (images.some((img) => (img.size || 0) > MAX_PER_IMAGE)) return `Each image must be <= ${MAX_PER_IMAGE / (1024 * 1024)} MB.`;
    if (total > MAX_TOTAL) return `Total attachments must be <= ${MAX_TOTAL / (1024 * 1024)} MB.`;
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
    if (!trimmed && attachedImages.length === 0) return;

    const error = validateImages(attachedImages);
    if (error) {
      setErrorMessage(error);
      return;
    }

    onSendMessage(trimmed, attachedImages.length ? attachedImages : undefined);

    // reset
    attachedImages.forEach((img) => { if (img.url) URL.revokeObjectURL(img.url); });
    setAttachedImages([]);
    setInputValue('');
    setErrorMessage(null);
  }, [inputValue, attachedImages, onSendMessage]);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (files) await processFiles(files); if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); };
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); };
  const handleDrop = async (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); const files = e.dataTransfer.files; if (files) await processFiles(files); };

  const removeAttachment = (id: string) => {
    setAttachedImages((prev) => { const target = prev.find((img) => img.id === id); if (target?.url) URL.revokeObjectURL(target.url); return prev.filter((img) => img.id !== id); });
    setErrorMessage(null);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items; if (!items) return; const files: File[] = [];
    for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.kind === 'file') { const file = it.getAsFile(); if (file) files.push(file); } }
    if (files.length) { await processFiles(files); e.preventDefault(); }
  };

  return (
    <div ref={dropRef} className={`input-box ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite"><div className="drop-inner">📥 Drop image(s) to attach</div></div>
      )}

      <div className="input-top">
        <textarea className="input-field" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Message SADIE..." rows={2} aria-label="Message SADIE" />

        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="attach-button" title="Attach images" onClick={handleAttachClick}>📷</button>
          <button className="send-button" onClick={handleSend} disabled={!inputValue.trim() && attachedImages.length === 0}>Send</button>
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

      {errorMessage && <div role="alert" className="image-error" style={{ color: '#ff3b30', marginTop: 8 }}>{errorMessage}</div>}
    </div>
  );
}


