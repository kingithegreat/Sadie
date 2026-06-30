import React, { useState, useCallback, useEffect, useRef } from 'react';

export interface Toast {
  id: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number; // ms, 0 = sticky
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" data-testid="toast-container" aria-live="polite">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    const dur = toast.duration ?? 5000;
    if (dur > 0) {
      timerRef.current = setTimeout(dismiss, dur);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast.duration, dismiss]);

  const icon = toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️';

  return (
    <div
      className={`toast-item toast-${toast.type || 'info'} ${exiting ? 'toast-exit' : 'toast-enter'}`}
      role="alert"
      onClick={dismiss}
      data-testid="toast-item"
    >
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={e => { e.stopPropagation(); dismiss(); }} aria-label="Dismiss">×</button>
    </div>
  );
};

export interface NotificationRecord {
  id: string;
  message: string;
  type: Toast['type'];
  timestamp: number;
}

/** Hook to manage toast state with persistent notification history */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info', duration?: number) => {
    const id = `toast-${++counterRef.current}-${Date.now()}`;
    setToasts(prev => [...prev, { id, message, type, duration }]);
    setHistory(prev => [{ id, message, type, timestamp: Date.now() }, ...prev].slice(0, 100));
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return { toasts, addToast, dismissToast, history, clearHistory };
}

export default ToastContainer;
