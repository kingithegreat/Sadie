import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { resolveVoiceEngine, whisperTranscribeOnce } from '../utils/speech';
import '../styles/voice-conversation.css';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceConversationProps {
  open: boolean;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  lastAssistantMessage?: string;
}

const WAVEFORM_BARS = 9;

const VoiceConversation: React.FC<VoiceConversationProps> = ({
  open,
  onClose,
  onSendMessage,
  lastAssistantMessage,
}) => {
  const [state, setState] = useState<VoiceState>('idle');
  const [continuousMode, setContinuousMode] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Track whether a voice conversation is "active" — i.e. the user has interacted
  // at least once in this session (so we auto-speak responses).
  const conversationActive = useRef(false);

  // Track the last assistant message we've already spoken so we don't repeat.
  const lastSpokenRef = useRef<string | undefined>(undefined);

  // Track whether the component is mounted and open (for async safety).
  const mountedRef = useRef(true);
  const openRef = useRef(open);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { openRef.current = open; }, [open]);

  // Reset state when the panel opens/closes.
  useEffect(() => {
    if (!open) {
      setState('idle');
      setTranscript('');
      setError(null);
      conversationActive.current = false;
      lastSpokenRef.current = undefined;
      window.electron?.ttsStop?.();
    }
  }, [open]);

  // ── Start listening ──
  const startListening = useCallback(async () => {
    setError(null);
    setState('listening');
    setTranscript('');

    try {
      let settings: any = {};
      try { settings = (await (window.electron as any)?.getSettings?.()) || {}; } catch { /* defaults */ }
      const engine = resolveVoiceEngine(settings.voiceEngine, {
        hasSapi: typeof window.electron?.startSpeechRecognition === 'function',
        hasWebSpeech: false, // conversation mode uses one-shot capture only
      });

      let text = '';
      let recognitionError: string | undefined;

      if (engine === 'whisper') {
        const res = await whisperTranscribeOnce({
          modelSize: settings.whisperModel,
          language: settings.voiceLanguage,
          micDeviceId: settings.voiceMicDeviceId,
          silenceStopSec: settings.voiceSilenceStopSec,
          onStatus: (s) => { if (mountedRef.current) setTranscript(s); },
        });
        text = res.text;
      } else {
        const result = await window.electron?.startSpeechRecognition?.();
        text = result?.success ? (result.text || '') : '';
        recognitionError = result?.error;
      }

      if (!mountedRef.current) return;

      if (text) {
        conversationActive.current = true;
        setTranscript(text);
        setState('thinking');
        onSendMessage(text);
      } else {
        setState('idle');
        setTranscript('');
        if (recognitionError) {
          setError(recognitionError);
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setState('idle');
      setError('Speech recognition failed. Please try again.');
    }
  }, [onSendMessage]);

  // ── Auto-speak assistant responses ──
  useEffect(() => {
    if (
      !open ||
      !conversationActive.current ||
      !lastAssistantMessage ||
      lastAssistantMessage === lastSpokenRef.current
    ) {
      return;
    }

    // A new assistant message arrived — speak it.
    lastSpokenRef.current = lastAssistantMessage;
    setState('speaking');
    setTranscript(lastAssistantMessage);

    window.electron?.ttsSpeak?.(lastAssistantMessage)
      .then(() => {
        if (!mountedRef.current || !openRef.current) return;
        setState('idle');
        if (continuousMode) {
          startListening();
        }
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setState('idle');
      });
  }, [open, lastAssistantMessage, continuousMode, startListening]);

  // ── Stop speaking ──
  const handleStop = useCallback(() => {
    window.electron?.ttsStop?.();
    setState('idle');
  }, []);

  // ── Mic button click ──
  const handleMicClick = useCallback(() => {
    if (state === 'idle') {
      startListening();
    }
  }, [state, startListening]);

  // ── Toggle continuous mode ──
  const toggleContinuous = useCallback(() => {
    setContinuousMode(prev => !prev);
  }, []);

  // Escape closes. A panel that fills the window and can only be dismissed with
  // the mouse is unusable by keyboard. This mattered less while the blanket
  // .app-container rule laid these out as inert page rows; now that they
  // genuinely cover everything, no-Escape is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;

  const micDisabled = state === 'thinking' || state === 'speaking' || state === 'listening';

  // Portalled to document.body. As a direct child of .app-container (Suspense and
  // ErrorBoundary render no DOM node of their own, so nesting inside them does
  // not change this) it was matched by the blanket rule in chatgpt-theme.css:
  //
  //   .app-container > *:not(.app-header):not(.widget-titlebar)... {
  //     position: relative; z-index: 1; }
  //
  // at (0,10,0), which beats this overlay's own `position: fixed`. Swept against
  // the live cascade, 13 of the app's 18 position:fixed classes were captured
  // that way — only the 5 named in that rule's :not() list survived.
  return createPortal((
    <div className="voice-conversation-overlay" onClick={onClose}>
      <div
        className="voice-conversation-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="voice-close-btn"
          onClick={onClose}
          aria-label="Close voice conversation"
        >
          ✕
        </button>

        {/* Status label */}
        <div className="voice-status" data-state={state}>
          {state === 'idle' && 'Ready'}
          {state === 'listening' && 'Listening...'}
          {state === 'thinking' && 'Thinking...'}
          {state === 'speaking' && 'Speaking...'}
        </div>

        {/* Mic button with pulse rings */}
        <div className="voice-mic-wrapper" data-state={state}>
          <span className="voice-ring" />
          <span className="voice-ring" />
          <span className="voice-ring" />
          <button
            className="voice-mic-btn"
            data-state={state}
            disabled={micDisabled}
            onClick={handleMicClick}
            aria-label={state === 'idle' ? 'Start listening' : state}
          >
            {state === 'idle' && <MicIcon />}
            {state === 'listening' && <MicIcon />}
            {state === 'thinking' && <ThinkingIcon />}
            {state === 'speaking' && <SpeakerIcon />}
          </button>
        </div>

        {/* Waveform bars */}
        <div className="voice-waveform" data-state={state}>
          {Array.from({ length: WAVEFORM_BARS }, (_, i) => (
            <div key={i} className="voice-waveform-bar" />
          ))}
        </div>

        {/* Transcript area */}
        <div className="voice-transcript">
          {state === 'thinking' && (
            <span className="voice-transcript-user">{transcript}</span>
          )}
          {state === 'speaking' && (
            <span className="voice-transcript-assistant">{transcript}</span>
          )}
          {state === 'idle' && transcript && (
            <span className="voice-transcript-assistant">{transcript}</span>
          )}
          {state === 'listening' && (
            <span className="voice-transcript-empty">Speak now...</span>
          )}
          {state === 'idle' && !transcript && (
            <span className="voice-transcript-empty">
              Tap the microphone to start a voice conversation
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="voice-controls">
          {(state === 'speaking' || state === 'listening') && (
            <button
              className="voice-control-btn voice-stop-btn"
              onClick={handleStop}
            >
              ■ Stop
            </button>
          )}
        </div>

        {/* Continuous mode toggle */}
        <div className="voice-toggle" onClick={toggleContinuous}>
          <div className="voice-toggle-track" data-on={String(continuousMode)}>
            <div className="voice-toggle-thumb" />
          </div>
          <span className="voice-toggle-label">Continuous conversation</span>
        </div>

        {/* Error */}
        {error && <div className="voice-error">{error}</div>}
      </div>
    </div>
  ), document.body);
};

/* ── SVG Icons ── */

const MicIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const ThinkingIcon: React.FC = () => (
  <div className="voice-thinking-dots">
    <span className="voice-dot" />
    <span className="voice-dot" />
    <span className="voice-dot" />
  </div>
);

const SpeakerIcon: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

export default VoiceConversation;
