import React, { useState, KeyboardEvent, useRef, useEffect } from 'react';
import { resizeImageFile } from '../utils/imageUtils';

interface ImageAttachment {
  filename?: string;
  path?: string;
  data?: string; // base64
  mimeType?: string;
  size?: number;
  url?: string; // preview URL (renderer-only)
  id?: string;
}

interface InputBoxProps {
  onSendMessage: (message: string, images?: ImageAttachment[] | null) => void;
}

const MAX_IMAGES = 5;
const MAX_PER_IMAGE = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB

const InputBox: React.FC<InputBoxProps> = ({ onSendMessage }) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      attachedImages.forEach(img => { if (img.url) URL.revokeObjectURL(img.url); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    const trimmedValue = inputValue.trim();

    if (!trimmedValue && attachedImages.length === 0) return;

    const total = attachedImages.reduce((s, a) => s + (a.size || 0), 0);
    if (attachedImages.length > MAX_IMAGES) {
      setErrorMessage(`You can attach up to ${MAX_IMAGES} images.`);
      return;
    }
    if (attachedImages.some(a => (a.size || 0) > MAX_PER_IMAGE)) {
      setErrorMessage(`Each image must be <= ${MAX_PER_IMAGE / (1024 * 1024)} MB.`);
      return;
    }
    if (total > MAX_TOTAL) {
      setErrorMessage(`Total attachments must be <= ${MAX_TOTAL / (1024 * 1024)} MB.`);
      return;
    }

    onSendMessage(trimmedValue, attachedImages.length ? attachedImages : undefined);

    setInputValue('');
    attachedImages.forEach(img => { if (img.url) URL.revokeObjectURL(img.url); });
    setAttachedImages([]);
    setErrorMessage(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const processFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const incoming = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    let totalSize = attachedImages.reduce((s, a) => s + (a.size || 0), 0);
    const newImages: ImageAttachment[] = [];

    for (const file of incoming) {
      if (attachedImages.length + newImages.length >= MAX_IMAGES) {
        setErrorMessage(`You can attach up to ${MAX_IMAGES} images.`);
        break;
      }

      try {
        const resized = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
        const size = resized.size || 0;
        if (size > MAX_PER_IMAGE) {
          setErrorMessage(`Image ${file.name} exceeds per-image limit (${MAX_PER_IMAGE / (1024 * 1024)} MB).`);
          continue;
        }
        if (totalSize + size > MAX_TOTAL) {
          setErrorMessage(`Adding ${file.name} would exceed total size limit (${MAX_TOTAL / (1024 * 1024)} MB).`);
          break;
        }

        totalSize += size;
        const id = `img-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
        newImages.push({ filename: resized.filename, mimeType: resized.mimeType, data: resized.data, url: resized.url, size, id });
      } catch (err) {
        try {
          const readerResult = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(file);
          });
          const data = readerResult.split(',')[1];
          const size = file.size || 0;
          if (size > MAX_PER_IMAGE) {
            setErrorMessage(`Image ${file.name} exceeds per-image limit (${MAX_PER_IMAGE / (1024 * 1024)} MB).`);
            continue;
          }
          if (totalSize + size > MAX_TOTAL) {
            setErrorMessage(`Adding ${file.name} would exceed total size limit (${MAX_TOTAL / (1024 * 1024)} MB).`);
            break;
          }
          totalSize += size;
          const id = `img-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
          newImages.push({ filename: file.name, mimeType: file.type, data, url: readerResult, size, id });
        } catch (e) {
          continue;
        }
      }
    }

    if (newImages.length) {
      setAttachedImages(prev => [...prev, ...newImages]);
      setErrorMessage(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    await processFiles(files as FileList);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id?: string) => {
    if (!id) return setAttachedImages([]);
    setAttachedImages(prev => {
      const found = prev.find(p => p.id === id);
      if (found && found.url) URL.revokeObjectURL(found.url);
      return prev.filter(p => p.id !== id);
    });
    setErrorMessage(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    await processFiles(files as FileList);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length) {
      await processFiles(files);
      e.preventDefault();
    }
  };

  return (
    <div ref={dropRef} className={`input-box ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-inner">📥 Drop image to attach</div>
        </div>
      )}
      <div className="input-top">
        <textarea
          className="input-field"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message SADIE..."
          rows={2}
          aria-label="Message SADIE"
        />
        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="attach-button" title="Attach images" onClick={handleAttachClick}>📷</button>
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!inputValue.trim() && attachedImages.length === 0}
          >
            Send
          </button>
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div className="image-preview-gallery">
          {attachedImages.map(img => (
            <div key={img.id} className="image-preview">
              <img src={img.url} alt={img.filename} className="image-thumb" />
              <div className="image-meta">
                <div className="image-filename">{img.filename}</div>
                <button className="remove-image" onClick={() => removeAttachment(img.id)} title="Remove image">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="image-error" style={{ color: '#ff3b30', marginTop: 8 }}>{errorMessage}</div>
      )}
    </div>
  );
};

export default InputBox;
import React, { useState, KeyboardEvent } from 'react';
import { resizeImageFile } from '../utils/imageUtils';

interface ImageAttachment {
  filename?: string;
  path?: string;
  data?: string; // base64
  mimeType?: string;
  size?: number;
  url?: string; // preview URL (renderer-only)
}

interface InputBoxProps {
  onSendMessage: (message: string, image?: ImageAttachment | null) => void;
}

const InputBox: React.FC<InputBoxProps> = ({ onSendMessage }) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<ImageAttachment | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const handleSend = () => {
    const trimmedValue = inputValue.trim();
    
    // Don't send empty messages unless there is an image
    if (!trimmedValue && !attachedImage) return;

    // Send message to parent with optional image
    onSendMessage(trimmedValue, attachedImage || undefined);

    // Clear input and attachment
    setInputValue('');
    setAttachedImage(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // Allow Shift+Enter for new line (default behavior)
  };

  const fileInputRef = React.createRef<HTMLInputElement>();

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const attachment = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
      setAttachedImage({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        data: attachment.data,
        url: attachment.url,
        size: attachment.size,
      });
    } catch (err) {
      // fallback to original file if resizing fails
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        setAttachedImage({ filename: file.name, mimeType: file.type || 'application/octet-stream', data: base64, url: result, size: file.size });
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = () => setAttachedImage(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // only clear when leaving the element
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;

    try {
      const attachment = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
      setAttachedImage({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        data: attachment.data,
        url: attachment.url,
        size: attachment.size,
      });
    } catch (err) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        setAttachedImage({ filename: file.name, mimeType: file.type || 'application/octet-stream', data: base64, url: result, size: file.size });
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const attachment = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
          setAttachedImage({
            filename: attachment.filename || 'pasted-image.png',
            mimeType: attachment.mimeType,
            data: attachment.data,
            url: attachment.url,
            size: attachment.size,
          });
        } catch (err) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            setAttachedImage({ filename: file.name || 'pasted-image.png', mimeType: file.type || 'application/octet-stream', data: base64, url: result, size: file.size });
          };
          reader.readAsDataURL(file);
        }
        e.preventDefault();
        return;
      }
    }
  };

  return (
    <div className={`input-box ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-inner">📥 Drop image to attach</div>
        </div>
      )}
      <div className="input-top">
        <textarea
          className="input-field"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message SADIE..."
          rows={2}
          aria-label="Message SADIE"
        />
        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="attach-button" title="Attach image" onClick={handleAttachClick}>📷</button>
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!inputValue.trim() && !attachedImage}
          >
            Send
          </button>
        </div>
      </div>

      {attachedImage && (
        <div className="image-preview">
          <img src={attachedImage.url} alt={attachedImage.filename} className="image-thumb" />
          <div className="image-meta">
            <div className="image-filename">{attachedImage.filename}</div>
            <button className="remove-image" onClick={removeAttachment} title="Remove image">Remove</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InputBox;
