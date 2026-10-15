import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ImageAttachment, DocumentAttachment } from '../../shared/types';
import { IMAGE_LIMITS } from '../../shared/constants';
import { resizeImageFile } from '../utils/imageUtils';
import Tooltip from './Tooltip';
import Icon from './Icon';
import { resolveVoiceEngine, whisperTranscribeOnce, type RecordingController, type VoiceEngine } from '../utils/speech';

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

export type ComposerImage = ImageAttachment & { id: string };
export type ComposerDocument = DocumentAttachment & { id: string };
/** A conversation's unfinished message. Kept in memory by the parent only. */
export type ComposerDraft = {
  text: string;
  images: ComposerImage[];
  documents: ComposerDocument[];
};

export const createEmptyComposerDraft = (): ComposerDraft => ({ text: '', images: [], documents: [] });

export const COMPOSER_ATTACHMENT_LIMITS = {
  maxImages: IMAGE_LIMITS.MAX_IMAGES,
  maxPerImageBytes: IMAGE_LIMITS.MAX_PER_IMAGE_BYTES,
  maxTotalImageBytes: IMAGE_LIMITS.MAX_TOTAL_BYTES,
  maxDocuments: 3,
  maxPerDocumentBytes: 10 * 1024 * 1024,
} as const;

export interface ComposerAttachmentScope {
  draftKey: string | undefined;
  /** Parent-owned draft lifecycle token; navigation and typing keep this token. */
  generation: number;
}

export type ComposerAttachments = Pick<ComposerDraft, 'images' | 'documents'>;
export interface ComposerAttachmentBatch extends ComposerAttachments {
  scope: ComposerAttachmentScope;
}
export type ComposerAttachmentDeliveryResult = { success: boolean; error?: string };
export type ComposerAttachmentMergeResult = { success: true; draft: ComposerDraft } | { success: false; error: string };

/** Merge into the latest origin draft, preserving its text and other files.
 * Revalidate at completion: concurrent picks may have consumed attachment slots.
 * The parent separately checks lifecycle ownership and inactive retention bytes.
 */
export function mergeComposerAttachments(previous: ComposerDraft, attachments: ComposerAttachments): ComposerAttachmentMergeResult {
  const images = [...previous.images, ...attachments.images];
  const documents = [...previous.documents, ...attachments.documents];
  if (images.length > COMPOSER_ATTACHMENT_LIMITS.maxImages) return { success: false, error: `You can attach up to ${COMPOSER_ATTACHMENT_LIMITS.maxImages} images.` };
  if (images.some(image => (image.size || 0) > COMPOSER_ATTACHMENT_LIMITS.maxPerImageBytes)) return { success: false, error: `Each image must be <= ${COMPOSER_ATTACHMENT_LIMITS.maxPerImageBytes / (1024 * 1024)} MB.` };
  if (images.reduce((total, image) => total + (image.size || 0), 0) > COMPOSER_ATTACHMENT_LIMITS.maxTotalImageBytes) return { success: false, error: `Total attachments must be <= ${COMPOSER_ATTACHMENT_LIMITS.maxTotalImageBytes / (1024 * 1024)} MB.` };
  if (documents.length > COMPOSER_ATTACHMENT_LIMITS.maxDocuments) return { success: false, error: `You can attach up to ${COMPOSER_ATTACHMENT_LIMITS.maxDocuments} documents.` };
  if (documents.some(document => document.size > COMPOSER_ATTACHMENT_LIMITS.maxPerDocumentBytes)) return { success: false, error: `Each document must be <= ${COMPOSER_ATTACHMENT_LIMITS.maxPerDocumentBytes / (1024 * 1024)} MB.` };
  return { success: true, draft: { ...previous, images, documents } };
}

interface AttachmentReadContext {
  scope: ComposerAttachmentScope;
  visitGeneration: number;
  initialImageCount: number;
  initialImageBytes: number;
  initialDocumentCount: number;
  deliver?: (batch: ComposerAttachmentBatch) => ComposerAttachmentDeliveryResult;
  reportError?: (message: string) => void;
  start?: (scope: ComposerAttachmentScope) => void;
  end?: (scope: ComposerAttachmentScope) => void;
}

interface ComposerVoiceSession {
  generation: number;
  draftKey: string | undefined;
  autoSend: boolean;
  engine?: VoiceEngine;
  controller?: RecordingController;
  recognition?: SpeechRecognition;
  stopRequested: boolean;
  finished: boolean;
  hasFinalTranscript: boolean;
}

export type InputBoxProps = {
  onSendMessage: (content: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => void;
  disabled?: boolean;
  draft?: ComposerDraft;
  onDraftChange?: (draft: ComposerDraft) => void;
  draftKey?: string;
  draftGeneration?: number;
  pendingAttachmentReads?: number;
  /** Must route by origin token, validate and merge into the latest origin draft. */
  onAttachmentsReady?: (batch: ComposerAttachmentBatch) => ComposerAttachmentDeliveryResult;
  /** Parent notification remains available when mode navigation unmounts this box. */
  onAttachmentReadError?: (message: string) => void;
  onAttachmentReadStart?: (scope: ComposerAttachmentScope) => void;
  onAttachmentReadEnd?: (scope: ComposerAttachmentScope) => void;
  suggestion?: { id: number; text: string } | null;
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

export function InputBox({ onSendMessage, disabled = false, draft, onDraftChange, draftKey, draftGeneration, pendingAttachmentReads = 0, onAttachmentsReady, onAttachmentReadError, onAttachmentReadStart, onAttachmentReadEnd, suggestion }: InputBoxProps) {
  const [localDraft, setLocalDraft] = useState<ComposerDraft>(createEmptyComposerDraft);
  const currentDraft = draft ?? localDraft;
  const draftRef = useRef(currentDraft);
  draftRef.current = currentDraft;
  const controlledRef = useRef(draft !== undefined);
  controlledRef.current = draft !== undefined;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const draftKeyRef = useRef(draftKey);
  draftKeyRef.current = draftKey;
  const attachmentVisitRef = useRef({ key: draftKey, parentGeneration: draftGeneration, generation: 0 });
  const attachmentReadsRef = useRef(new Map<number, number>());
  const parentAttachmentReadsRef = useRef(pendingAttachmentReads);
  parentAttachmentReadsRef.current = pendingAttachmentReads;
  const [, refreshAttachmentReads] = useState(0);
  if (attachmentVisitRef.current.key !== draftKey || attachmentVisitRef.current.parentGeneration !== draftGeneration) {
    attachmentVisitRef.current = { key: draftKey, parentGeneration: draftGeneration, generation: attachmentVisitRef.current.generation + 1 };
  }
  const draftRevisionRef = useRef(0);
  const mountedRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { text: inputValue, images: attachedImages, documents: attachedDocuments } = currentDraft;

  const updateDraft = useCallback((update: (previous: ComposerDraft) => ComposerDraft) => {
    if (!mountedRef.current) return;
    const next = update(draftRef.current);
    draftRef.current = next;
    draftRevisionRef.current += 1;
    if (!controlledRef.current) setLocalDraft(next);
    onDraftChangeRef.current?.(next);
  }, []);

  const setInputValue = useCallback((value: React.SetStateAction<string>) => {
    updateDraft(previous => ({ ...previous, text: typeof value === 'function' ? value(previous.text) : value }));
  }, [updateDraft]);
  const setAttachedImages = useCallback((value: React.SetStateAction<ComposerImage[]>) => {
    updateDraft(previous => ({ ...previous, images: typeof value === 'function' ? value(previous.images) : value }));
  }, [updateDraft]);
  const setAttachedDocuments = useCallback((value: React.SetStateAction<ComposerDocument[]>) => {
    updateDraft(previous => ({ ...previous, documents: typeof value === 'function' ? value(previous.documents) : value }));
  }, [updateDraft]);

  // Sharpening a draft before sending it. The draft before the rewrite is kept
  // so Undo is one click — replacing what someone typed with no way back is a
  // hostile thing for an app to do, however good the rewrite is.
  const [improving, setImproving] = useState(false);
  const [preImproveDraft, setPreImproveDraft] = useState<string | null>(null);
  const [rewrittenText, setRewrittenText] = useState<string | null>(null);
  const [improveNote, setImproveNote] = useState<string | null>(null);
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);

  useEffect(() => {
    setPreImproveDraft(null);
    setRewrittenText(null);
    setImproveNote(null);
    setSuggestionNote(null);
  }, [draftKey]);

  useEffect(() => {
    if (!suggestion) return;
    const existing = draftRef.current;
    if (existing.text || existing.images.length || existing.documents.length) {
      setSuggestionNote('Your draft is still here. Send or clear it before choosing a starter.');
    } else {
      setInputValue(suggestion.text);
      setSuggestionNote('Edit this starter to say what you need, then choose Send.');
    }
    textareaRef.current?.focus();
  }, [suggestion, setInputValue]);

  const handleImprovePrompt = useCallback(async () => {
    if (improving) return;
    const capturedDraft = draftRef.current;
    const revision = draftRevisionRef.current;
    const scope = draftKeyRef.current;
    setImproving(true);
    setImproveNote(null);
    try {
      const res = await window.electron?.improvePrompt?.(capturedDraft.text);
      if (!mountedRef.current || scope !== draftKeyRef.current) return;
      if (revision !== draftRevisionRef.current || draftRef.current !== capturedDraft) {
        setImproveNote('Your draft changed while the rewrite was running. Your latest wording and attachments are kept.');
        return;
      }
      if (!res?.success || !res.improved) {
        // Says why rather than doing nothing — a button that silently no-ops
        // reads as broken.
        setImproveNote(res?.error || 'Could not rewrite that just now.');
        return;
      }
      setPreImproveDraft(capturedDraft.text);
      setRewrittenText(res.improved);
      setInputValue(res.improved);
    } catch {
      if (mountedRef.current && scope === draftKeyRef.current) setImproveNote('Could not rewrite that just now.');
    } finally {
      if (mountedRef.current) setImproving(false);
    }
  }, [improving, setInputValue]);

  const handleUndoImprove = useCallback(() => {
    if (preImproveDraft === null) return;
    setInputValue(preImproveDraft);
    setPreImproveDraft(null);
    setRewrittenText(null);
    setImproveNote(null);
  }, [preImproveDraft, setInputValue]);

  // Typing after a rewrite means the user has taken it from here, so the undo
  // offer stops applying — restoring at that point would discard their edits.
  useEffect(() => {
    if (preImproveDraft !== null && inputValue !== rewrittenText) {
      setPreImproveDraft(null);
      setRewrittenText(null);
    }
  }, [inputValue, preImproveDraft, rewrittenText]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceAutoSend, setVoiceAutoSend] = useState(false);
  const [listenTimer, setListenTimer] = useState(0);
  const listenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceGenerationRef = useRef(0);
  const voiceSessionRef = useRef<ComposerVoiceSession | null>(null);
  const voiceAutoSendPending = useRef<{ session: ComposerVoiceSession; revision: number } | null>(null);
  const voiceAutoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [voiceAutoSendEpoch, setVoiceAutoSendEpoch] = useState(0);
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [ragStatus, setRagStatus] = useState<null | 'indexing' | { ok: boolean; message: string }>(null);
  const isCurrentVoiceSession = useCallback((session: ComposerVoiceSession) =>
    mountedRef.current && voiceSessionRef.current === session &&
    voiceGenerationRef.current === session.generation && draftKeyRef.current === session.draftKey, []);

  const queueVoiceAutoSend = useCallback((session: ComposerVoiceSession) => {
    if (!session.autoSend || !isCurrentVoiceSession(session)) return;
    voiceAutoSendPending.current = { session, revision: draftRevisionRef.current };
    // WebSpeech may end after manual Stop already cleared the listening state.
    setVoiceAutoSendEpoch(epoch => epoch + 1);
  }, [isCurrentVoiceSession]);

  const invalidateVoiceSession = useCallback(() => {
    const session = voiceSessionRef.current;
    // Revoke authority before cancel/abort can synchronously emit callbacks.
    voiceSessionRef.current = null;
    voiceGenerationRef.current += 1;
    voiceAutoSendPending.current = null;
    if (voiceAutoSendTimerRef.current) clearTimeout(voiceAutoSendTimerRef.current);
    voiceAutoSendTimerRef.current = null;
    try { session?.controller?.cancel(); } catch { /* Already stopped. */ }
    try { session?.recognition?.abort(); } catch { /* Already stopped. */ }
    if (session?.engine === 'sapi' && !session.finished) {
      try { void window.electron?.stopSpeechRecognition?.().catch(() => {}); } catch { /* Best-effort cancellation. */ }
    }
  }, []);

  useLayoutEffect(() => {
    setIsListening(false);
    setErrorMessage(null);
    return invalidateVoiceSession;
  }, [draftKey, invalidateVoiceSession]);

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

  // Voice input is always available: the local Whisper engine is bundled and
  // needs only a microphone (SAPI / Web Speech remain as optional engines).
  useEffect(() => {
    setSpeechSupported(true);
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

  // Start voice input using the engine selected in Settings → Voice.
  // Default is local Whisper — accurate with any accent, no training needed.
  const startListening = useCallback(async () => {
    if (voiceSessionRef.current && !voiceSessionRef.current.finished && !voiceSessionRef.current.stopRequested) return;
    invalidateVoiceSession();
    const session: ComposerVoiceSession = {
      generation: ++voiceGenerationRef.current, draftKey: draftKeyRef.current, autoSend: voiceAutoSend,
      stopRequested: false, finished: false, hasFinalTranscript: false,
    };
    voiceSessionRef.current = session;
    const current = () => isCurrentVoiceSession(session);
    setIsListening(true);
    setErrorMessage(null);
    let settings: any = {};
    try { settings = (await window.electron?.getSettings?.()) || {}; } catch { /* Defaults. */ }
    if (!current()) return;
    if (session.stopRequested) {
      session.finished = true;
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const engine = resolveVoiceEngine(settings.voiceEngine, {
      hasSapi: typeof window.electron?.startSpeechRecognition === 'function',
      hasWebSpeech: !!SpeechRecognitionCtor,
    });
    session.engine = engine;
    const receiveTranscript = (text: string) => {
      if (!current()) return;
      session.finished = true;
      session.controller = undefined;
      setIsListening(false);
      if (text) {
        setInputValue(previous => previous + (previous ? ' ' : '') + text);
        setErrorMessage(null);
        queueVoiceAutoSend(session);
      } else {
        setErrorMessage('No speech detected — try speaking louder or check your microphone in Settings → Voice.');
      }
    };

    if (engine === 'whisper') {
      try {
        const { text } = await whisperTranscribeOnce({
          modelSize: settings.whisperModel,
          language: settings.voiceLanguage,
          micDeviceId: settings.voiceMicDeviceId,
          silenceStopSec: settings.voiceSilenceStopSec,
          onStatus: status => { if (current() && !session.finished) setErrorMessage(status); },
          onController: controller => {
            if (!current() || session.finished) {
              try { controller.cancel(); } catch { /* Best-effort cancellation of a late microphone. */ }
              return;
            }
            session.controller = controller;
            if (session.stopRequested) controller.stop();
          },
        });
        receiveTranscript(text);
      } catch (error: any) {
        if (!current()) return;
        session.finished = true;
        session.controller = undefined;
        console.error('[Voice] Whisper error:', error);
        setIsListening(false);
        const message = String(error?.message || error);
        setErrorMessage(/Permission|NotAllowed/i.test(message)
          ? 'Microphone access denied. Please allow it in system settings.'
          : 'Voice error: ' + message);
      }
      return;
    }

    if (engine === 'sapi') {
      setErrorMessage('🎤 Listening… speak now');
      try {
        const result = await window.electron!.startSpeechRecognition!();
        if (!current()) return;
        if (result.success) receiveTranscript(result.text);
        else {
          session.finished = true;
          setIsListening(false);
          setErrorMessage('Voice error: ' + (result.error || 'Speech recognition failed'));
        }
      } catch (error: any) {
        if (!current()) return;
        session.finished = true;
        console.error('[Voice] Error:', error);
        setIsListening(false);
        setErrorMessage('Voice error: ' + (error?.message || String(error)));
      }
      return;
    }

    if (!SpeechRecognitionCtor) {
      session.finished = true;
      setIsListening(false);
      setErrorMessage('Speech recognition not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    session.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = settings.voiceLanguage && settings.voiceLanguage !== 'en' ? settings.voiceLanguage : 'en-US';
    recognition.onstart = () => {
      if (!current() || session.finished || session.stopRequested) return;
      setIsListening(true);
      setErrorMessage(null);
    };
    recognition.onresult = event => {
      if (!current() || session.finished) return;
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        if (event.results[index].isFinal) transcript += event.results[index][0].transcript;
      }
      if (transcript.trim()) {
        session.hasFinalTranscript = true;
        setInputValue(previous => previous + (previous ? ' ' : '') + transcript);
      }
    };
    recognition.onerror = event => {
      if (!current() || session.finished) return;
      session.finished = true;
      console.error('Speech recognition error:', event.error);
      voiceAutoSendPending.current = null;
      setIsListening(false);
      switch (event.error) {
        case 'network':
          setErrorMessage('Voice input requires internet connection. Please check your network and try again.');
          break;
        case 'not-allowed':
        case 'permission-denied':
          setErrorMessage('Microphone access denied. Please allow in browser/system settings.');
          break;
        case 'no-speech':
        case 'aborted':
          break;
        default:
          setErrorMessage('Voice error: ' + event.error);
      }
    };
    recognition.onend = () => {
      if (!current() || session.finished) return;
      session.finished = true;
      session.recognition = undefined;
      setIsListening(false);
      if (session.hasFinalTranscript) queueVoiceAutoSend(session);
    };
    try {
      recognition.start();
    } catch (error: any) {
      if (!current()) return;
      session.finished = true;
      setIsListening(false);
      setErrorMessage('Voice error: ' + (error?.message || String(error)));
    }
  }, [voiceAutoSend, setInputValue, invalidateVoiceSession, isCurrentVoiceSession, queueVoiceAutoSend]);

  const stopListening = useCallback(() => {
    const session = voiceSessionRef.current;
    if (!session || !isCurrentVoiceSession(session)) return;
    session.stopRequested = true;
    // Stop finishes the current recording; navigation/unmount cancel it.
    if (session.controller) { session.controller.stop(); return; }
    session.recognition?.stop();
    setIsListening(false);
  }, [isCurrentVoiceSession]);

  const toggleVoiceInput = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const ragInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const { MAX_IMAGES, MAX_PER_IMAGE_BYTES: MAX_PER_IMAGE, MAX_TOTAL_BYTES: MAX_TOTAL } = IMAGE_LIMITS;
  const MAX_DOCUMENTS = COMPOSER_ATTACHMENT_LIMITS.maxDocuments;
  const MAX_DOC_SIZE = COMPOSER_ATTACHMENT_LIMITS.maxPerDocumentBytes;

  const captureAttachmentRead = (): AttachmentReadContext => ({
    scope: { draftKey: draftKeyRef.current, generation: draftGeneration ?? attachmentVisitRef.current.generation },
    visitGeneration: attachmentVisitRef.current.generation,
    // Reads only need initial constraints, not a second retained snapshot of
    // every existing encoded attachment while an asynchronous decoder waits.
    initialImageCount: draftRef.current.images.length,
    initialImageBytes: draftRef.current.images.reduce((total, image) => total + (image.size || 0), 0),
    initialDocumentCount: draftRef.current.documents.length,
    deliver: onAttachmentsReady,
    reportError: onAttachmentReadError,
    start: onAttachmentReadStart,
    end: onAttachmentReadEnd,
  });

  const reportAttachmentError = (context: AttachmentReadContext, message: string) => {
    if (context.reportError) {
      try { context.reportError(message); return; } catch { /* Fall back to the mounted composer. */ }
    }
    if (mountedRef.current) setErrorMessage(message);
  };

  const trackAttachmentRead = async (context: AttachmentReadContext, read: () => Promise<void>) => {
    const generation = context.scope.generation;
    attachmentReadsRef.current.set(generation, (attachmentReadsRef.current.get(generation) || 0) + 1);
    if (mountedRef.current) refreshAttachmentReads(revision => revision + 1);
    try {
      context.start?.(context.scope);
      await read();
    } catch {
      reportAttachmentError(context, 'HomeBot could not attach the file. Your draft is kept. Choose the file again in the original chat.');
    } finally {
      const remaining = (attachmentReadsRef.current.get(generation) || 1) - 1;
      if (remaining > 0) attachmentReadsRef.current.set(generation, remaining);
      else attachmentReadsRef.current.delete(generation);
      if (mountedRef.current) refreshAttachmentReads(revision => revision + 1);
      try { context.end?.(context.scope); }
      catch { reportAttachmentError(context, 'HomeBot could not finish keeping this attachment. Check the original chat and choose the file again if it is missing.'); }
    }
  };

  const deliverAttachments = (context: AttachmentReadContext, attachments: ComposerAttachments) => {
    if (!attachments.images.length && !attachments.documents.length) return;
    const names = [...attachments.images, ...attachments.documents].map(file => file.filename || 'file').join(', ');
    const failed = (reason: string) => reportAttachmentError(context,
      `${names} was not attached to its original draft. ${reason} Your current draft is kept. You can choose the file again in the chat you want.`);
    if (context.deliver) {
      // The captured parent callback owns retention even while another chat or
      // mode is visible. Never substitute the current visible key for the origin.
      try {
        const result = context.deliver({ scope: context.scope, ...attachments });
        if (result?.success !== true) failed(result?.error || 'HomeBot could not keep the attachment.');
      } catch { failed('HomeBot could not keep the attachment.'); }
      return;
    }
    if (!mountedRef.current || context.scope.draftKey !== draftKeyRef.current ||
      context.visitGeneration !== attachmentVisitRef.current.generation) {
      failed('The original composer changed while the file was being read.');
      return;
    }
    const merged = mergeComposerAttachments(draftRef.current, attachments);
    if (!merged.success) { failed(merged.error); return; }
    updateDraft(() => merged.draft);
    setErrorMessage(null);
  };

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
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A parent-retained draft still owns its previews after mode navigation.
      if (!controlledRef.current) {
        draftRef.current.images.forEach(img => {
          if (img.url?.startsWith('blob:')) URL.revokeObjectURL(img.url);
        });
      }
    };
  }, []);

  const handleSend = useCallback(() => {
    if (disabled) return;
    const generation = attachmentVisitRef.current.parentGeneration ?? attachmentVisitRef.current.generation;
    if (attachmentReadsRef.current.has(generation) || parentAttachmentReadsRef.current > 0) {
      setErrorMessage('Please wait for the selected files to finish loading, then choose Send. Your draft is kept.');
      return;
    }
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

    invalidateVoiceSession();
    // A late local read cannot append to the next unsent message after Send.
    // Controlled parents revoke their own lifecycle token in the send/reset path.
    attachmentVisitRef.current.generation += 1;
    setIsListening(false);
    onSendMessage(
      trimmed, 
      attachedImages.length ? attachedImages : undefined,
      attachedDocuments.length ? attachedDocuments : undefined
    );

    updateDraft(createEmptyComposerDraft);
    setPreImproveDraft(null);
    setRewrittenText(null);
    setSuggestionNote(null);
    setErrorMessage(null);
  }, [inputValue, attachedImages, attachedDocuments, onSendMessage, disabled, updateDraft, invalidateVoiceSession]);

  // Voice auto-send: trigger handleSend once the input value updates after voice recognition
  useEffect(() => {
    const pending = voiceAutoSendPending.current;
    if (!pending) return;
    voiceAutoSendPending.current = null;
    if (!isCurrentVoiceSession(pending.session) || pending.revision !== draftRevisionRef.current || !inputValue.trim()) return;
    const capturedDraft = draftRef.current;
    const timer = setTimeout(() => {
      voiceAutoSendTimerRef.current = null;
      if (isCurrentVoiceSession(pending.session) && pending.revision === draftRevisionRef.current && draftRef.current === capturedDraft) handleSend();
    }, 100);
    voiceAutoSendTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (voiceAutoSendTimerRef.current === timer) voiceAutoSendTimerRef.current = null;
    };
  }, [inputValue, handleSend, voiceAutoSendEpoch, isCurrentVoiceSession]);

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

  const processFiles = async (files: FileList | File[], context = captureAttachmentRead()) => {
    if (!files || files.length === 0) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) return;

    await trackAttachmentRead(context, async () => {
      let total = context.initialImageBytes;
      const newImages: ComposerImage[] = [];
      const errors: string[] = [];

      for (const file of incoming) {
        if (context.initialImageCount + newImages.length >= MAX_IMAGES) {
          errors.push(`You can attach up to ${MAX_IMAGES} images.`);
          break;
        }

        try {
          const resized = await resizeImageFile(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.8 });
          const size = resized.size || file.size || 0;
          if (size > MAX_PER_IMAGE) {
            errors.push(`Image ${file.name} exceeds per-image limit.`);
            continue;
          }
          if (total + size > MAX_TOTAL) { errors.push(`Adding ${file.name} would exceed total size limit.`); break; }
          total += size;
          const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const url = resized.url;
          newImages.push({ ...resized, filename: resized.filename ?? file.name, mimeType: resized.mimeType ?? file.type, size, url, id } as ComposerImage);
        } catch {
          // fallback -> make a dataURL
          try {
            const readerResult = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.onabort = reject;
              reader.readAsDataURL(file);
            });
            const size = file.size || 0;
            if (size > MAX_PER_IMAGE) { errors.push(`Image ${file.name} exceeds per-image limit.`); continue; }
            if (total + size > MAX_TOTAL) { errors.push(`Adding ${file.name} would exceed total size limit.`); break; }
            total += size; const id = `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const [prefix, base64Part] = readerResult.split(',');
            const data = base64Part || '';
            const mimeType = prefix?.match(/data:(.*);base64/)?.[1] || file.type;
            newImages.push({ filename: file.name, mimeType, data, url: readerResult, size, id } as ComposerImage);
          } catch { errors.push(`Could not read ${file.name}. Choose the file again in the original chat.`); }
        }
      }

      deliverAttachments(context, { images: newImages, documents: [] });
      if (errors.length) reportAttachmentError(context, errors.join(' '));
    });
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

  const processDocuments = async (files: File[], context = captureAttachmentRead()) => {
    if (!files.length) return;
    await trackAttachmentRead(context, async () => {
      const newDocs: ComposerDocument[] = [];
      const errors: string[] = [];

      for (const file of files) {
        if (context.initialDocumentCount + newDocs.length >= MAX_DOCUMENTS) {
          errors.push(`You can attach up to ${MAX_DOCUMENTS} documents.`);
          break;
        }

        if (file.size > MAX_DOC_SIZE) {
          errors.push(`Document ${file.name} exceeds ${MAX_DOC_SIZE / (1024 * 1024)} MB limit.`);
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
            reader.onabort = reject;
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
          errors.push(`Could not read ${file.name}. Choose the file again in the original chat.`);
        }
      }

      deliverAttachments(context, { images: [], documents: newDocs });
      if (errors.length) reportAttachmentError(context, errors.join(' '));
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || []);
    e.currentTarget.value = '';
    if (files.length) await processFiles(files);
  };

  const handleDocChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files || []);
    e.currentTarget.value = '';
    if (files.length) await processDocuments(files);
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
    const context = captureAttachmentRead();
    // Start both reads before either can settle, so origin ownership has no
    // zero-pending gap between the image and document parts of one selection.
    await Promise.all([processFiles(imageFiles, context), processDocuments(docFiles, context)]);
    if (docFiles.length) {
      // Also index document files into RAG for future queries
      const ragEligible = docFiles.filter(f => (f as any).path);
      if (ragEligible.length) handleRagIndex(ragEligible).catch(() => {});
    }
    // Index non-image, non-chat-document files into RAG automatically
    if (ragFiles.length) await handleRagIndex(ragFiles);
  };

  const removeAttachment = (id: string) => {
    setAttachedImages((prev) => {
      const target = prev.find(img => img.id === id);
      if (target?.url?.startsWith('blob:')) URL.revokeObjectURL(target.url);
      return prev.filter(img => img.id !== id);
    });
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
      e.preventDefault();
      const context = captureAttachmentRead();
      const imageFiles = files.filter(f => f.type.startsWith('image/'));
      const docFiles = files.filter(f => isDocumentFile(f) && !f.type.startsWith('image/'));
      await Promise.all([processFiles(imageFiles, context), processDocuments(docFiles, context)]);
    }
  };

  return (
    <div ref={dropRef} className={`input-box ${isDragging ? 'dragging' : ''} ${uncensoredMode ? 'uncensored' : ''}`} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {isDragging && (
        <div className="drop-overlay" role="status" aria-live="polite"><div className="drop-inner">📥 Drop files to attach</div></div>
      )}

      {improveNote && (
        <div className="improve-note" data-testid="improve-note" role="status">
          {improveNote}
        </div>
      )}
      {suggestionNote && <div role="status" className="improve-note">{suggestionNote}</div>}
      {(pendingAttachmentReads > 0 || attachmentReadsRef.current.has(draftGeneration ?? attachmentVisitRef.current.generation)) &&
        <div role="status" aria-live="polite" className="improve-note">Preparing selected files. Your draft is kept.</div>}

      <div className="input-top">
        <textarea ref={textareaRef} className="input-field" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder={PLACEHOLDER_HINTS[placeholderIndex]} rows={2} aria-label="Message HomeBot" maxLength={4000} disabled={disabled} />
        <div className={`char-counter${inputValue.length > 3000 ? (inputValue.length > 3800 ? ' danger' : ' warning') : ''}`}>{inputValue.length} / 4000</div>

        <div className="input-actions">
          <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden-file-input" aria-label="Attach images" onChange={handleFileChange} />
          <input ref={docInputRef} type="file" accept=".pdf,.docx,.doc,.txt,.md,.json,.csv" multiple className="hidden-file-input" aria-label="Attach documents" onChange={handleDocChange} />
          <input ref={ragInputRef} type="file" accept="*" className="hidden-file-input" aria-label="Index file for RAG" onChange={handleRagFileChange} />
          <Tooltip content="Rewrite this so HomeBot can act on it">
            <button
              className="attach-button improve-prompt-button"
              aria-label="Improve this prompt"
              data-testid="improve-prompt"
              onClick={handleImprovePrompt}
              disabled={improving || !inputValue.trim()}
              type="button"
            >
              {improving ? '…' : '✨'}
            </button>
          </Tooltip>
          {preImproveDraft !== null && (
            <Tooltip content="Put your original wording back">
              <button
                className="attach-button improve-undo-button"
                aria-label="Undo the rewrite"
                data-testid="improve-undo"
                onClick={handleUndoImprove}
                type="button"
              >
                ↶
              </button>
            </Tooltip>
          )}
          <Tooltip content="Attach images">
            <button className="attach-button" aria-label="Attach images to this message" onClick={handleAttachClick}><Icon name="image" /></button>
          </Tooltip>
          <Tooltip content="Attach documents — PDF, Word or text">
            <button className="attach-button" aria-label="Attach documents — PDF, Word or text" onClick={handleDocAttachClick}><Icon name="document" /></button>
          </Tooltip>
          <Tooltip content="Add a file HomeBot can answer questions about">
            <button
              className="attach-button rag-index-button"
              aria-label="Add a file HomeBot can answer questions about"
              onClick={() => ragInputRef.current?.click()}
              disabled={ragStatus === 'indexing'}
            ><Icon name={ragStatus === 'indexing' ? 'spinner' : 'paperclip'} className={ragStatus === 'indexing' ? 'hb-icon-spin' : undefined} /></button>
          </Tooltip>
          {speechSupported && (
            <>
              <button
                className={`voice-button ${isListening ? 'listening voice-btn-active voice-pulse' : 'voice-btn-idle'}`}
                title={isListening ? `Stop listening (${listenTimer}s) — Ctrl+Shift+V` : 'Voice input — Ctrl+Shift+V'}
                aria-label={isListening ? `Stop listening — ${listenTimer} seconds elapsed` : 'Voice input'}
                onClick={toggleVoiceInput}
              >
                <Icon name="mic" />
                {isListening ? <span className="voice-timer">{listenTimer}s</span> : null}
              </button>
              <button
                className={`attach-button ${voiceAutoSend ? 'voice-auto-active' : ''}`}
                title={voiceAutoSend ? 'Auto-send after voice: ON' : 'Auto-send after voice: OFF'}
                aria-label={voiceAutoSend ? 'Auto-send after voice is on' : 'Auto-send after voice is off'}
                aria-pressed={voiceAutoSend}
                onClick={() => setVoiceAutoSend(v => !v)}
                style={{ padding: '2px 4px', minWidth: 0 }}
              >
                <Icon name={voiceAutoSend ? 'zap' : 'pause'} />
              </button>
            </>
          )}
          <button className="send-button" onClick={handleSend} disabled={disabled || pendingAttachmentReads > 0 || attachmentReadsRef.current.has(draftGeneration ?? attachmentVisitRef.current.generation) || (!inputValue.trim() && attachedImages.length === 0 && attachedDocuments.length === 0)}>
            <Icon name="send" />
            <span>Send</span>
          </button>
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div className="image-preview-gallery">
          {attachedImages.map((img) => (
            <div key={img.id} className="image-preview" title={img.filename ?? 'image'}>
              {img.url && <img src={img.url} alt={img.filename} className="image-thumb" />}
              <Tooltip content="Remove image">
                <button className="remove-image" onClick={() => removeAttachment(img.id)} aria-label={`Remove ${img.filename}`}><Icon name="close" /></button>
              </Tooltip>
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
              <Tooltip content="Remove document">
                <button className="remove-document" onClick={() => removeDocument(doc.id)} aria-label={`Remove ${doc.filename}`}><Icon name="close" /></button>
              </Tooltip>
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


