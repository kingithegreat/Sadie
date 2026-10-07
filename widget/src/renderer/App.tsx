import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import UpdateBanner from './components/UpdateBanner';
import { debug as logDebug } from '../shared/logger';
import { chatIdeaToJobInput } from '../shared/chat-idea';
import ChatInterface from "./components/ChatInterface";
import { createEmptyComposerDraft, mergeComposerAttachments, type ComposerDraft,
  type ComposerAttachmentBatch, type ComposerAttachmentScope } from './components/InputBox';
import { prepareInactiveDraftRetention } from './utils/composerDraftBudget';
import { retainRetryRequest } from './utils/retryRequestBudget';
import './styles/first-user.css';
import StatusIndicator from "./components/StatusIndicator";
import ActionConfirmation from "./components/ActionConfirmation";
import PermissionModal from './components/PermissionModal';
import { ToastContainer, useToasts } from './components/ToastContainer';
import ModelSelector from './components/ModelSelector';
import Logo from './components/Logo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { copyTextToClipboard } from './utils/clipboard';

// Lazy-load panels that aren't visible on first render
const ToolsPanel = lazy(() => import("./components/ToolsPanel"));
const FeedsPanel = lazy(() => import("./components/FeedsPanel"));
const ConnectionsPanel = lazy(() => import("./components/ConnectionsPanel"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const FirstRunModal = lazy(() => import('./components/FirstRunModal'));
const ConversationSidebar = lazy(() => import("./components/ConversationSidebar"));
const AutomationCenter = lazy(() => import("./components/AutomationCenter").then(m => ({ default: m.AutomationCenter })));
const ImageGenerator = lazy(() => import("./components/ImageGenerator"));
const DocumentViewer = lazy(() => import("./components/DocumentViewer"));
const QuizPanel = lazy(() => import("./components/QuizPanel"));
const ModulesPanel = lazy(() => import('./components/ModulesPanel'));
const BrowserPanel = lazy(() => import("./components/workspace/BrowserPanel"));
const TokenCounter = lazy(() => import("./components/TokenCounter"));
const RagPanel = lazy(() => import("./components/RagPanel"));
const TerminalPanel = lazy(() => import("./components/TerminalPanel"));
const WorkspaceShell = lazy(() => import("./components/workspace/WorkspaceShell"));
const TelemetryDashboard = lazy(() => import("./components/TelemetryDashboard"));
const ShortcutsPanel = lazy(() => import("./components/ShortcutsPanel"));
const NotificationHistory = lazy(() => import("./components/NotificationHistory"));
const DashboardPanel = lazy(() => import("./components/DashboardPanel"));
const VoiceConversation = lazy(() => import("./components/VoiceConversation"));
import type {
  ChatMessage
} from "./types";
import type {
  Message as SharedMessage,
  ConnectionStatus,
  ImageAttachment,
  DocumentAttachment,
  HomeBotRequestWithImages,
  Settings as SharedSettings
} from '../shared/types';
import { recommendLocalModelForTask } from '../shared/model-advisor';
import { resolveTheme, followsSystem, systemPrefersDark } from '../shared/theme';
import type { ResolvedTheme } from '../shared/theme';
import type { ModelRecommendation } from '../shared/model-advisor';
import { resetCliOnlyFields } from '../shared/provider-urls';

// Types
type Status = ConnectionStatus;
// The mode list lives in shared/modes.ts so main can validate against the same
// one. It was written to be the single source of truth and this file had been
// restating it, which is how the two could have drifted.
import type { AppMode } from '../shared/modes';
import { useModules } from './modules/useModules';
import { isBundledModuleMode, registeredModuleViews } from './modules/bundled';
import {
  detectLeakedToolCalls,
  stripLeakedToolCalls,
  describeLeak,
} from '../shared/leaked-tool-calls';

interface AppProps {
  /** Optional initial messages for tests */
  initialMessages?: SharedMessage[];
}

interface PendingModelSuggestion {
  text: string;
  messageText: string;
  images?: ImageAttachment[] | null;
  documents?: DocumentAttachment[] | null;
  recommendation: ModelRecommendation;
  scope: SubmissionScope;
}

interface SubmissionScope {
  id: string;
  generation: number;
  conversationId: string | null;
  draft: ComposerDraft;
  retained?: boolean;
  committed?: boolean;
  assistantId?: string;
  creationFlow?: ConversationPromptFlow;
  creationPending?: boolean;
}

interface ConversationPromptFlow {
  generation: number;
  originConversationId: string | null;
  conversationId: string | null;
  prompt: string;
  revision: number;
  savedRevision: number;
  promise: Promise<boolean> | null;
  predecessor?: Promise<boolean> | null;
  purpose?: 'draft';
  hasSubmission?: boolean;
  pendingSubmissions?: number;
}

interface StreamReply {
  conversationId: string;
  message: ChatMessage;
  placeholderSaved: Promise<boolean>;
  terminal: boolean;
  failed?: boolean;
  saving: boolean;
  save: (repair?: boolean) => Promise<void>;
  finish: (updates: Partial<ChatMessage>) => void;
  stop: () => void;
}

const App: React.FC<AppProps> = ({ initialMessages }) => {
  // small helper to create ids
  const newId = useCallback(() => `id-${Date.now()}-${Math.random().toString(16).slice(2,8)}`, []);

  // Diagnostic log for E2E traces
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      window.electron?.getEnv?.().then(env => console.log('[DIAG] Env from main:', env)).catch(console.error);
    }
    // Capture: renderer started
    try { (window as any).homebotCapture?.log('[Renderer] started'); } catch (e) {}
  }, []);

  // State
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (!initialMessages || !initialMessages.length) return [];
    // convert shared messages into renderer ChatMessage shape
    return initialMessages.map((m) => ({
      id: m.id ?? newId(),
      role: m.role as any,
      content: m.content,
      createdAt: Date.parse(m.timestamp) || Date.now(),
      updatedAt: undefined,
      streamId: (m as any).streamId,
      streamingState: (m.streamingState as any) || undefined,
      error: typeof (m as any).error === 'string' ? (m as any).error : ((m as any).error ? 'error' : null),
    }));
  });
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [, setPendingToolCall] = useState<any | null>(null);
  const [pendingConfirmationData, setPendingConfirmationData] = useState<any>(null);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [permissionRequestData, setPermissionRequestData] = useState<{ requestId?: string; missingPermissions?: string[]; reason?: string; streamId?: string; timeoutMs?: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ragPanelOpen, setRagPanelOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notifHistoryOpen, setNotifHistoryOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState(true); // Start in widget mode
  const [uncensoredMode, setUncensoredMode] = useState(true);
  const { toasts, addToast, dismissToast, history: notifHistory, clearHistory: clearNotifHistory } = useToasts();
  const ollamaToastRef = useRef<string | null>(null);

  // Initialise widget mode from main process and listen for changes
  useEffect(() => {
    window.electron?.getWidgetMode?.().then(isWidget => setWidgetMode(isWidget));
    const unsub = window.electron?.onWidgetModeChanged?.(isWidget => setWidgetMode(isWidget));
    return () => { unsub?.(); };
  }, []);

  // Track uncensored mode for widget-mode model selector
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
    const onChanged = (e: Event) => setUncensoredMode((e as CustomEvent).detail);
    window.addEventListener('homebot:uncensored-mode-changed', onChanged);
    return () => window.removeEventListener('homebot:uncensored-mode-changed', onChanged);
  }, []);

  const handleToggleWidgetMode = useCallback(async () => {
    const newMode = await window.electron?.toggleWidgetMode?.();
    if (typeof newMode === 'boolean') setWidgetMode(newMode);
  }, []);

  const newConversationRef = useRef<() => void>(() => {});

  // The shortcut handler below is registered once, with [] deps, so it closes
  // over the first render's empty `messages` forever. A ref is how the other
  // shortcuts in that handler already reach current state.
  const lastAssistantRef = useRef<string>('');
  useEffect(() => {
    lastAssistantRef.current = messages
      .filter(m => m.role === 'assistant' && m.streamingState === 'finished')
      .slice(-1)[0]?.content || '';
  }, [messages]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        newConversationRef.current();
      } else if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(prev => !prev);
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSidebarOpen(true);
      } else if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setMode('chat');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setMode('automation');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setMode('image');
      } else if (e.ctrlKey && e.key === '4') {
        e.preventDefault();
        setMode('documents');
      } else if (e.ctrlKey && e.key === '5') {
        e.preventDefault();
        setMode('quiz');
      } else if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setMode('dashboard');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault();
        setMode('code');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        setMode('media');
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        // The Shortcuts panel has advertised "Ctrl + Shift + C — Copy last
        // response" while nothing in the app bound it: pressing it did nothing
        // at all, and left whatever was already on the clipboard in place, so
        // the next paste produced the wrong text.
        //
        // Both cases are tested because Caps Lock changes which one arrives.
        // Plain Ctrl+C is deliberately untouched — that is ordinary text copy.
        e.preventDefault();
        if (lastAssistantRef.current) {
          void copyTextToClipboard(lastAssistantRef.current);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Track which conversations have had a title generated to avoid duplicates
  const titleGeneratedRef = useRef<Set<string>>(new Set());
  const [settings, setSettings] = useState<SharedSettings>({
    alwaysOnTop: true,
    n8nUrl: 'http://localhost:5678',
    widgetHotkey: 'Ctrl+Shift+Space'
  });
  const settingsMutationGenerationRef = useRef(0);
  const [isHydrated, setIsHydrated] = useState(false);
  // What the ROUTER says would answer right now — the header displays this,
  // never its own derivation. `settings.chatModel` as the header source is
  // how every lying-header bug happened: it shows the local fallback even
  // while cloud routing is active.
  const [activeModel, setActiveModel] = useState<{ source?: 'cloud' | 'local'; model?: string; reason?: string | null }>({});
  const [status, setStatus] = useState<Status>({ n8n: 'checking', ollama: 'checking' });
  const [backendDiagnostic, setBackendDiagnostic] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const conversationNavigationRef = useRef(0);
  const conversationNavigationPreparationRef = useRef(0);
  const conversationActivationRef = useRef<Promise<void>>(Promise.resolve());
  const [composerDraft, setComposerDraft] = useState<ComposerDraft>(createEmptyComposerDraft);
  const composerDraftRef = useRef(composerDraft);
  composerDraftRef.current = composerDraft;
  const conversationDraftsRef = useRef(new Map<string, ComposerDraft>());
  const attachmentGenerationRef = useRef(0);
  const attachmentDraftGenerationsRef = useRef(new Map<string, number>());
  const attachmentDraftOwnersRef = useRef(new Map<number, string>());
  const pendingAttachmentReadsRef = useRef(new Map<number, number>());
  const [, refreshPendingAttachmentReads] = useState(0);
  const attachmentGenerationFor = useCallback((key: string) => {
    let generation = attachmentDraftGenerationsRef.current.get(key);
    if (generation === undefined) {
      generation = ++attachmentGenerationRef.current;
      attachmentDraftGenerationsRef.current.set(key, generation);
      attachmentDraftOwnersRef.current.set(generation, key);
    }
    return generation;
  }, []);
  const invalidateAttachmentDraft = useCallback((key: string) => {
    const generation = attachmentDraftGenerationsRef.current.get(key);
    if (generation !== undefined) attachmentDraftOwnersRef.current.delete(generation);
    attachmentDraftGenerationsRef.current.delete(key);
  }, []);
  const migrateAttachmentDraft = useCallback((from: string, to: string) => {
    if (from === to) return;
    const generation = attachmentDraftGenerationsRef.current.get(from);
    invalidateAttachmentDraft(to);
    if (generation === undefined) return;
    attachmentDraftGenerationsRef.current.delete(from);
    attachmentDraftGenerationsRef.current.set(to, generation);
    attachmentDraftOwnersRef.current.set(generation, to);
  }, [invalidateAttachmentDraft]);
  const hasPendingNullAttachments = useCallback(() => {
    const generation = attachmentDraftGenerationsRef.current.get('new');
    return generation !== undefined && (pendingAttachmentReadsRef.current.get(generation) || 0) > 0;
  }, []);
  // Empty inactive scopes without reads have nothing to retain. Never recycle a
  // generation: late callbacks cannot gain authority on an A → B → A visit.
  const activeDraftKey = conversationId || 'new';
  for (const [key, generation] of attachmentDraftGenerationsRef.current) {
    if (key !== activeDraftKey && !conversationDraftsRef.current.has(key) && !pendingAttachmentReadsRef.current.has(generation)) {
      attachmentDraftGenerationsRef.current.delete(key);
      attachmentDraftOwnersRef.current.delete(generation);
    }
  }
  const activeDraftGeneration = attachmentGenerationFor(activeDraftKey);
  const handleAttachmentReadStart = useCallback((scope: ComposerAttachmentScope) => {
    pendingAttachmentReadsRef.current.set(scope.generation, (pendingAttachmentReadsRef.current.get(scope.generation) || 0) + 1);
    refreshPendingAttachmentReads(revision => revision + 1);
  }, []);
  const handleAttachmentReadEnd = useCallback((scope: ComposerAttachmentScope) => {
    const remaining = (pendingAttachmentReadsRef.current.get(scope.generation) || 1) - 1;
    if (remaining > 0) pendingAttachmentReadsRef.current.set(scope.generation, remaining);
    else pendingAttachmentReadsRef.current.delete(scope.generation);
    refreshPendingAttachmentReads(revision => revision + 1);
  }, []);
  const handleAttachmentsReady = useCallback((batch: ComposerAttachmentBatch) => {
    const owner = attachmentDraftOwnersRef.current.get(batch.scope.generation);
    if (!owner || deletedConversationIdsRef.current.has(owner) || attachmentDraftGenerationsRef.current.get(owner) !== batch.scope.generation) {
      return { success: false, error: 'That draft was sent, cleared, or deleted while the file was loading. Reattach the file to the draft you want to use.' };
    }
    const currentKey = conversationIdRef.current || 'new';
    if (owner === 'new' && currentKey !== 'new') {
      return { success: false, error: 'The new draft changed while the file was loading. Reattach the file in the chat you want to use.' };
    }
    const previous = owner === currentKey ? composerDraftRef.current
      : conversationDraftsRef.current.get(owner) || createEmptyComposerDraft();
    const merged = mergeComposerAttachments(previous, batch);
    if (!merged.success) return merged;
    if (owner === currentKey) {
      composerDraftRef.current = merged.draft;
      setComposerDraft(merged.draft);
    } else {
      const retention = prepareInactiveDraftRetention(conversationDraftsRef.current,
        { key: owner, draft: merged.draft, activatingKey: currentKey });
      if (!retention.allowed) return { success: false,
        error: 'There is not enough room to keep this file in the original chat. Send or clear an unfinished draft, then reattach the file there.' };
      conversationDraftsRef.current = retention.nextDrafts;
      addToast('The file is ready in its original chat. Open that chat to review and send it.', 'info', 8000);
    }
    return { success: true };
  }, [addToast]);
  const knownConversationIdsRef = useRef(new Set<string>());
  const unusedConversationCleanupRef = useRef(new Set<string>());
  const deletedConversationIdsRef = useRef(new Set<string>());
  const retryRequestsRef = useRef(new Map<string, HomeBotRequestWithImages>());
  const [heldSubmissions, setHeldSubmissions] = useState<SubmissionScope[]>([]);
  const heldSubmissionsRef = useRef(heldSubmissions);
  heldSubmissionsRef.current = heldSubmissions;
  const [conversationSystemPrompt, setConversationSystemPrompt] = useState<string>('');
  const conversationSystemPromptRef = useRef(conversationSystemPrompt);
  conversationSystemPromptRef.current = conversationSystemPrompt;
  const conversationPromptFlowRef = useRef<ConversationPromptFlow | null>(null);
  const pendingConversationPromptsRef = useRef(new Map<string, ConversationPromptFlow>());
  const conversationPromptWritesRef = useRef(new Map<string, Promise<void>>());
  const conversationPromptDeletionRef = useRef(new Set<string>());
  const [mode, setMode] = useState<AppMode>('chat');
  // Where the IDE's Back button returns to: the last view of the main
  // interface before Code mode was entered. Chat is the app's starting view.
  const modeBeforeCodeRef = useRef<AppMode>('chat');
  useEffect(() => {
    if (mode !== 'code') modeBeforeCodeRef.current = mode;
  }, [mode]);
  // Code mode and the header Workspace button show ONE WorkspaceShell. It is
  // mounted on first use and then only hidden, never unmounted, so leaving
  // the IDE keeps its open tabs and unsaved edits for when the user returns.
  const workspaceVisible = mode === 'code' || workspaceOpen;
  const [workspaceEverShown, setWorkspaceEverShown] = useState(false);
  useEffect(() => {
    if (workspaceVisible) setWorkspaceEverShown(true);
  }, [workspaceVisible]);
  const workspaceMounted = workspaceEverShown || workspaceVisible;
  const leaveWorkspaceBack = useCallback(() => {
    setWorkspaceOpen(false);
    setMode(current => (current === 'code' ? modeBeforeCodeRef.current : current));
  }, []);
  const leaveWorkspaceToChat = useCallback(() => {
    setWorkspaceOpen(false);
    setMode(current => (current === 'code' ? 'chat' : current));
  }, []);
  const leaveWorkspaceHome = useCallback(() => {
    setWorkspaceOpen(false);
    setMode('dashboard');
  }, []);
  const moduleState = useModules();
  const moduleViews = registeredModuleViews(moduleState.modules);
  const ActiveModuleView = moduleViews.find(view => view.id === mode)?.Component;
  const studioAvailable = moduleViews.some(view => view.id === 'media');
  useEffect(() => {
    if (!moduleState.loading && isBundledModuleMode(mode) && !ActiveModuleView) setMode('modules');
  }, [mode, moduleState.loading, ActiveModuleView]);
  // Context handed over when the assistant navigates somewhere — what the user
  // was talking about, so the destination opens ready rather than empty. Held
  // here rather than in each panel so a panel can start consuming it without
  // anything upstream changing.
  const [navContext, setNavContext] = useState<Record<string, unknown> | null>(null);
  const [vramGB, setVramGB] = useState<number | null>(null);

  // Keep the header's model in sync with the router's actual decision.
  // Re-asks after every settings change (all saves flow through setSettings)
  // and whenever uncensored mode flips — so the header can only lie if the
  // router itself does.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await (window as any).electron?.resolveActiveModel?.();
        if (!cancelled && r?.success) {
          setActiveModel({ source: r.source, model: r.model, reason: r.reason ?? null });
        }
      } catch { /* header falls back to settings-derived display */ }
    })();
    return () => { cancelled = true; };
  }, [settings, uncensoredMode]);
  const lastModelTipRef = useRef<string>('');
  const [pendingModelSuggestion, setPendingModelSuggestion] = useState<PendingModelSuggestion | null>(null);

    // active stream subscriptions by streamId (use Map for convenience)
    const streamSubsRef = useRef<Map<string, { unsubscribe: () => void }>>(new Map());
    // Live replies, pending writes and failed recovery copies own their content
    // independently of the visible chat. Dispatch caps this set without eviction.
    const streamRepliesRef = useRef(new Map<string, StreamReply>());
    const streamReplyReservationsRef = useRef(new Set<string>());
    // Stop saves immediately and keeps at most eight terminal listeners for a
    // genuine end confirmation. These markers contain no draft or reply bytes.
    const stoppedStreamConfirmationsRef = useRef(new Map<string, {
      conversationId: string; token: symbol; reconciling?: boolean;
    }>());
    const [unsavedReplyIds, setUnsavedReplyIds] = useState<string[]>([]);
    // test-only watchdog timers per stream to avoid hanging 'streaming' state in tests
    const streamWatchersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Resolve the theme SETTING ('dark' | 'light' | 'system') to the theme STATE
  // the UI renders. Held in state so the app root, <html> and <body> all carry
  // the same resolved value — previously the root div got the raw setting, so
  // on 'system' it read data-theme="system", which matches no stylesheet.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(settings.theme, systemPrefersDark()),
  );

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(settings.theme, systemPrefersDark());
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
      document.body.setAttribute('data-theme', resolved);
    };
    apply();

    // Only when following the OS does the theme need a live listener. Without
    // this the app stayed on whatever the OS was at launch until settings
    // changed, which reads as "dark mode is broken".
    if (!followsSystem(settings.theme)) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // addEventListener is the modern API; addListener is kept as a fallback
    // for older Chromium runtimes, and either way we remove what we added.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    if (typeof (mq as any).addListener === 'function') {
      (mq as any).addListener(apply);
      return () => (mq as any).removeListener(apply);
    }
    return;
  }, [settings.theme]);

  // Load settings and conversation on boot
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Load settings and conversations in parallel for faster boot
        const [loaded, convResult] = await Promise.all([
          window.electron.getSettings(),
          window.electron.loadConversations?.(),
        ]);
        if (mounted && loaded) setSettings(prev => ({ ...prev, ...loaded }));
        // Check connection status on boot
        window.electron.checkConnection?.().then(c => {
          if (mounted && c) setStatus(c);
        }).catch(() => {});
        // Detect GPU VRAM for model size warnings
        window.electron.detectGpuVram?.().then(r => {
          if (mounted && r?.success && r.vramGB) setVramGB(r.vramGB);
        }).catch(() => {});
        if (mounted && convResult?.success && convResult.data) {
          for (const item of Object.values(convResult.data.conversations || {})) knownConversationIdsRef.current.add(item.id);
          // Always start with a fresh chat — history is accessible via the sidebar
          const newConv = await window.electron.createConversation?.();
          if (newConv?.success && newConv.data) {
            knownConversationIdsRef.current.add(newConv.data.id);
            setConversationId(newConv.data.id);
            setConversationSystemPrompt(newConv.data.systemPrompt || '');
            try { await window.electron.setActiveConversation?.(newConv.data.id); } catch (e) {}
          }
        } else {
          // No conversations yet - create first one
          const newConv = await window.electron.createConversation?.();
          if (mounted && newConv?.success && newConv.data) {
            knownConversationIdsRef.current.add(newConv.data.id);
            setConversationId(newConv.data.id);
          }
        }
      } catch (err) {
        console.error("Failed to load settings/conversations", err);
        // Fallback to a local-only conversation ID
        setConversationId('default');
      } finally {
        if (mounted) setIsHydrated(true);
      }
    })();
    return () => { mounted = false; };
  }, [newId, initialMessages]);

  // show first-run onboarding modal if enabled
  const [firstRunOpen, setFirstRunOpen] = useState(false);

  // "Skip setup" used to be a one-way door: the wizard never came back, and a
  // person who skipped before understanding what setup does had no path to it
  // except reinstalling. Settings raises this event to reopen it on demand.
  useEffect(() => {
    const reopen = () => setFirstRunOpen(true);
    window.addEventListener('homebot:reopen-first-run', reopen);
    return () => window.removeEventListener('homebot:reopen-first-run', reopen);
  }, []);

  useEffect(() => {
    if (isHydrated && settings?.firstRun) {
      logDebug('[Renderer] Opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).homebotCapture?.log('[Renderer] Opening first-run modal'); } catch (e) {}
      setFirstRunOpen(true);
    } else {
      logDebug('[Renderer] Not opening first-run modal - isHydrated:', isHydrated, 'firstRun:', settings?.firstRun);
      try { (window as any).homebotCapture?.log('[Renderer] Not opening first-run modal'); } catch (e) {}
    }
  }, [isHydrated, settings?.firstRun]);

  // Ensure we clean up any remaining stream listeners when the component
  // unmounts to avoid memory leaks.
  useEffect(() => {
    return () => {
      for (const subs of streamSubsRef.current.values()) {
        try { subs.unsubscribe(); } catch (e) {}
      }
      streamSubsRef.current.clear();
      stoppedStreamConfirmationsRef.current.clear();
    };
  }, []);

  // Listen for confirmation requests from main process (dangerous operations)
  useEffect(() => {
    const unsubscribe = window.electron.onConfirmationRequest?.((data) => {
      setPendingConfirmationData({
        confirmationId: data.confirmationId,
        message: data.message,
        streamId: data.streamId
      });
      setAwaitingConfirmation(true);
    });

    const permUnsub = window.electron.onPermissionRequest?.((data) => {
      setPermissionRequestData({ requestId: data.requestId, missingPermissions: data.missingPermissions, reason: data.reason, streamId: data.streamId, timeoutMs: (data as any).timeoutMs });
      setPermissionModalOpen(true);
    });

    const reminderUnsub = window.electron.onReminderFired?.((data) => {
      setMessages(prev => [...prev, {
        id: `rem-${Date.now()}`,
        role: 'system' as const,
        content: `⏰ **Reminder:** ${data.message}`,
        createdAt: Date.now(),
        error: null,
      }]);
      if (settings.notificationsEnabled !== false) {
        const duration = settings.notificationDuration ?? 8000;
        addToast(`⏰ ${data.message}`, 'warning', duration);
      }
    });

    // Proactive morning briefing — appears as an assistant message on app launch
    const briefingUnsub = window.electron.onProactiveBriefing?.((data) => {
      setMessages(prev => [...prev, {
        id: `briefing-${Date.now()}`,
        role: 'assistant' as const,
        content: data.content,
        createdAt: Date.now(),
        error: null,
      }]);
    });

    // One-time toast when the main process auto-detects VRAM and applies a
    // hardware profile.
    //
    // This is one of the first things a new user ever sees, and it used to read
    // "GPU detected (NVIDIA GeForce RTX 2050): 4 GB VRAM — 4 GB model profile
    // applied automatically." Three pieces of vocabulary (GPU, VRAM, model
    // profile) and no answer to the only question the reader has, which is
    // whether they need to do anything. They do not — so say that.
    const hwUnsub = window.electron.onHardwareProfileApplied?.((data) => {
      const gpu = data.gpuName ? `Found your graphics card (${data.gpuName}). ` : '';
      addToast(
        `${gpu}HomeBot has set itself up to run well on this PC — nothing for you to do. You can change this in Settings.`,
        'info',
        10000
      );
    });

    // One-time toast when the main process finds an existing-but-corrupt
    // settings file and resets it to defaults (a timestamped backup of the
    // original file is kept alongside it for manual recovery).
    const configRecoveredUnsub = window.electron.onConfigRecovered?.((data) => {
      addToast(
        `⚠️ Your settings file was invalid and has been reset to defaults.${data.backupPath ? ' A backup of the original was saved for recovery.' : ''}`,
        'warning',
        0
      );
    });

    // The assistant taking the user to another panel. Chat is meant to be the
    // front door to everything, so when what someone wants lives in a panel the
    // model sends them there rather than describing where the button is.
    //
    // The payload is stashed before the mode changes so the destination renders
    // with context on its first paint rather than opening empty and filling in
    // a frame later.
    const navigateUnsub = window.electron.onNavigate?.((request) => {
      setNavContext(request.payload ?? null);
      setMode(request.mode);
      if (request.reason) {
        addToast(request.reason, 'info', 6000);
      }
    });

    // Subscribe to title updates pushed from main (keeps sidebar title in sync)
    const titleUnsub = window.electron.onTitleUpdated?.((data) => {
      // Dispatch a custom DOM event so ConversationSidebar can patch its local list
      window.dispatchEvent(new CustomEvent('homebot:title-updated', { detail: data }));
    });

    // Ollama health — show a warning banner if Ollama isn't reachable on startup
    const ollamaUnsub = window.electron.onOllamaStatus?.((data) => {
      if (!data.online) {
        if (ollamaToastRef.current) dismissToast(ollamaToastRef.current);
        // Was: "Ollama not running — start Ollama to use local models.
        // (http://...)" — a product name the user never chose, a raw URL they
        // cannot act on, and no way forward. The ▶ Start button already sits in
        // the header (OllamaBadge); point there.
        ollamaToastRef.current = addToast(
          'The AI on this PC isn’t running, so HomeBot can’t answer privately right now. Use the ▶ Start button at the top of the window to launch it.',
          'warning',
          0
        );
      } else if (ollamaToastRef.current) {
        dismissToast(ollamaToastRef.current);
        ollamaToastRef.current = null;
      }
      setStatus(prev => ({ ...prev, ollama: data.online ? 'online' : 'offline' }));
    });

    const modelFbUnsub = window.electron.onModelFallback?.((data) => {
      settingsMutationGenerationRef.current += 1;
      addToast(
        `Model "${data.from}" not installed — switched to "${data.to}"`,
        'warning',
        8000
      );
      setSettings(prev => ({ ...prev, chatModel: data.to }));
    });

    const compactUnsub = window.electron.onConversationCompacted?.((data) => {
      addToast(
        `Conversation auto-compacted: ${data.originalCount} messages archived down to ${data.compactedCount}`,
        'info',
        6000
      );
    });

    // Re-read settings after subscribing to catch any model fallback that fired before mount
    const settingsRefreshGeneration = settingsMutationGenerationRef.current;
    let settingsRefreshActive = true;
    window.electron.getSettings?.().then(s => {
      if (settingsRefreshActive && settingsRefreshGeneration === settingsMutationGenerationRef.current && s?.chatModel) {
        setSettings(prev => ({ ...prev, chatModel: s.chatModel }));
      }
    }).catch(() => {});

    return () => {
      settingsRefreshActive = false;
      unsubscribe?.();
      permUnsub?.();
      reminderUnsub?.();
      briefingUnsub?.();
      hwUnsub?.();
      configRecoveredUnsub?.();
      navigateUnsub?.();
      titleUnsub?.();
      ollamaUnsub?.();
      modelFbUnsub?.();
      compactUnsub?.();
    };
  }, []);

  // Removed: a listener for a 'homebot:capture-saved' DOM event that nothing in
  // the codebase has ever dispatched. Its comment said the event came "from
  // header (StatusIndicator)", and StatusIndicator has no such dispatch — the
  // capture-logs feature it belonged to has no UI at any point in the chain, so
  // the log bundle it was meant to announce cannot be produced from the app at
  // all. Deleted rather than wired: the listener alone was telling the next
  // reader that a feature exists, which cost this audit time to disprove.

  // Auto-generate conversation title after the first assistant reply finishes
  useEffect(() => {
    if (!conversationId) return;
    // Already generated for this conversation — skip
    if (titleGeneratedRef.current.has(conversationId)) return;

    const nonSystem = messages.filter(m => m.role !== 'system');
    const userMsgs = nonSystem.filter(m => m.role === 'user');
    const assistantMsgs = nonSystem.filter(m => m.role === 'assistant');

    // Trigger exactly once: first user + first assistant reply that has finished streaming
    if (userMsgs.length !== 1 || assistantMsgs.length !== 1) return;
    const assistant = assistantMsgs[0];
    if (assistant.streamingState && assistant.streamingState !== 'finished') return;
    if (!assistant.content || assistant.content.length < 10) return;

    titleGeneratedRef.current.add(conversationId);

    window.electron.generateTitle?.({
      conversationId,
      userMessage: userMsgs[0].content || '',
      assistantReply: assistant.content,
    }).catch(() => { /* best-effort, silent fail */ });
  }, [messages, conversationId]);

  /**
   * Load user settings from main process
   */
  const updateMessage = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m)));
  }, []);

  // Helper to persist a message to the conversation store
  // Accept an optional convIdOverride so callers can persist immediately after
  // creating a new conversation without relying on state propagation.
  const persistMessage = useCallback(async (msg: ChatMessage, convIdOverride?: string) => {
    const convId = convIdOverride || conversationId;
    if (!convId) return false;
    try {
      // Map renderer StreamingState to shared type (exclude 'cancelling' which is renderer-only)
      const mappedStreamingState = msg.streamingState === 'cancelling' ? 'cancelled' : msg.streamingState;
      const sharedMsg: SharedMessage = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.createdAt).toISOString(),
        streamingState: mappedStreamingState as SharedMessage['streamingState'],
        error: !!msg.error,
      };
      // Debug: log persistence attempt and result
      try { (window as any).__HOMEBOT_RENDERER_LOGS = (window as any).__HOMEBOT_RENDERER_LOGS || []; (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage conv=${convId} id=${msg.id} len=${String(msg.content).length}`); } catch (e) {}
      const res = await window.electron.addMessage?.(convId, sharedMsg);
      try { (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage result=${JSON.stringify(res)}`); } catch (e) {}
      return res?.success === true;
    } catch (err) {
      console.error('Failed to persist message:', err);
      try { (window as any).__HOMEBOT_RENDERER_LOGS.push(`[Renderer] addMessage error=${String(err)}`); } catch (e) {}
      return false;
    }
  }, [conversationId]);

  // Helper to update a persisted message
  const updatePersistedMessage = useCallback(async (messageId: string, updates: Partial<SharedMessage>, convIdOverride?: string) => {
    const convId = convIdOverride || conversationId;
    if (!convId) return false;
    try {
      const result = await window.electron.updateMessage?.(convId, messageId, updates);
      return result?.success === true;
    } catch (err) {
      console.error('Failed to update persisted message:', err);
      return false;
    }
  }, [conversationId]);


  /**
   * Save user settings to main process
   */
  const saveSettings = useCallback(async (newSettings: SharedSettings) => {
    // An earlier read must not restore its model after a newer setup/settings
    // choice starts saving, including while its acknowledgement is pending.
    settingsMutationGenerationRef.current += 1;
    const updated = await window.electron.saveSettings(newSettings);
    setSettings(prev => ({ ...prev, ...updated }));
  }, []);

  const saveModelSettings = useCallback(async (newSettings: SharedSettings) => {
    try {
      await saveSettings(newSettings);
      return true;
    } catch (error: any) {
      setMessages(prev => [...prev, {
        id: newId(), role: 'system', createdAt: Date.now(), error: null,
        content: `Could not save the model change: ${error?.message || 'Please try again.'} Your previous settings are still active.`,
      }]);
      return false;
    }
  }, [saveSettings, newId]);

  /**
   * Handle creating a new conversation
   */
  const prepareDraftNavigation = useCallback((destination?: string) => {
    const result = prepareInactiveDraftRetention(conversationDraftsRef.current, {
      key: conversationIdRef.current || 'new', draft: composerDraftRef.current, activatingKey: destination,
    });
    if (!result.allowed) addToast(result.reason === 'bytes'
      ? 'These unfinished chats contain too many files to keep while switching. Send a draft or remove some attachments first. Your current draft is kept.'
      : 'Too many unfinished chats. Send or clear a draft before switching chats. Your current draft is kept.', 'warning', 8000);
    return result;
  }, [addToast]);

  const activateConversation = useCallback(async (id: string, generation: number, adopt?: (drafts: Map<string, ComposerDraft>) => void,
    options?: { preserveCurrentDraft?: boolean }) => {
    // Serial acknowledgements keep a slower older activation from becoming the
    // backend's final selection after the newest navigation has completed.
    const activation = conversationActivationRef.current.then(async () => {
      if (generation !== conversationNavigationRef.current) return false;
      const unownedDraft = () => !options?.preserveCurrentDraft && !conversationIdRef.current &&
        (!!composerDraftRef.current.text || !!composerDraftRef.current.images.length || !!composerDraftRef.current.documents.length ||
          !!(conversationPromptFlowRef.current?.promise && conversationPromptFlowRef.current.hasSubmission) || hasPendingNullAttachments());
      const explainUnownedDraft = () => addToast('Your new draft is kept here. Open the destination again so HomeBot can keep it in its own chat before switching.', 'warning', 8000);
      // A draft may appear after navigation started (including deletion while
      // a selection read is pending). Never commit it under a synthetic key.
      if (unownedDraft()) { explainUnownedDraft(); return false; }
      // Lazy guidelines adoption keeps this exact composer active. It must not
      // retain a second, inaccessible copy under the old null-ID "new" key.
      const planRetention = () => prepareDraftNavigation(options?.preserveCurrentDraft ? conversationIdRef.current || 'new' : id);
      if (!planRetention().allowed) return false;
      const result = await window.electron.setActiveConversation?.(id);
      if (result?.success !== true) throw new Error(result?.error || 'Could not open this conversation. Please try again.');
      const retention = planRetention();
      if (generation !== conversationNavigationRef.current || !retention.allowed || unownedDraft()) {
        if (unownedDraft()) explainUnownedDraft();
        const adopted = conversationIdRef.current;
        if (adopted && adopted !== id) {
          const restored = await window.electron.setActiveConversation?.(adopted);
          if (restored?.success !== true) throw new Error('Could not restore the current conversation.');
        }
        return false;
      }
      // Commit the adopted renderer identity within this same serial operation,
      // before cleanup or the next activation can inspect it.
      adopt?.(retention.nextDrafts);
      return true;
    });
    conversationActivationRef.current = activation.then(() => undefined, () => undefined);
    return activation;
  }, [prepareDraftNavigation, addToast, hasPendingNullAttachments]);

  const cleanUnusedConversation = useCallback(async (created: import('../shared/types').StoredConversation) => {
    const id = created.id;
    try {
      if (!knownConversationIdsRef.current.has(id) && id !== conversationIdRef.current && !created.messages.length) {
        const latest = await window.electron.getConversation?.(id);
        if (latest?.success && latest.data && latest.data.createdAt === created.createdAt && !latest.data.messages.length &&
            !knownConversationIdsRef.current.has(id) && id !== conversationIdRef.current) {
          unusedConversationCleanupRef.current.add(id);
          try {
            const removed = await window.electron.deleteConversation?.(id);
            if (removed?.success !== true) throw new Error('Could not remove the unused conversation.');
          } finally {
            unusedConversationCleanupRef.current.delete(id);
          }
        }
      }
    } catch (error) {
      console.error('Could not clean up unused conversation:', error);
      addToast('HomeBot could not remove an unused empty chat. You can remove it from conversations.', 'warning', 8000);
    } finally {
      // createConversation also selects its new record in main. Reconcile at
      // execution time, after queued acknowledgements, with the adopted UI ID.
      const reconciliation = conversationActivationRef.current.then(async () => {
        const adopted = conversationIdRef.current;
        if (!adopted) return;
        try {
          const result = await window.electron.setActiveConversation?.(adopted);
          if (result?.success !== true) throw new Error(result?.error || 'Active chat was not acknowledged.');
        } catch (error) {
          console.error('Could not reconcile active conversation:', error);
          addToast('HomeBot could not restore the active chat. Open it again from conversations before continuing.', 'error', 0);
        }
      });
      conversationActivationRef.current = reconciliation.then(() => undefined, () => undefined);
      await reconciliation;
    }
  }, [addToast]);

  const getCurrentConversationPromptFlow = useCallback(() => {
    const flow = conversationPromptFlowRef.current;
    const owner = conversationIdRef.current;
    const generation = conversationNavigationRef.current;
    if (!flow || flow.conversationId !== owner || flow.prompt !== conversationSystemPromptRef.current) return null;
    if (flow.generation === generation) return flow;
    // A failed navigation changes the generation but leaves this editor and
    // adopted identity visible. Rebase without authorizing the older async work.
    const rebased: ConversationPromptFlow = { ...flow, generation, promise: null,
      predecessor: flow.promise || flow.predecessor };
    conversationPromptFlowRef.current = rebased;
    if (owner && rebased.savedRevision !== rebased.revision) pendingConversationPromptsRef.current.set(owner, rebased);
    return rebased;
  }, []);

  const getOrCreateNullConversationFlow = useCallback(() => {
    const current = getCurrentConversationPromptFlow();
    if (current) return current;
    const flow: ConversationPromptFlow = {
      generation: conversationNavigationRef.current, originConversationId: null, conversationId: null,
      prompt: conversationSystemPromptRef.current, revision: 0,
      savedRevision: conversationSystemPromptRef.current ? -1 : 0, promise: null, purpose: 'draft',
    };
    conversationPromptFlowRef.current = flow;
    return flow;
  }, [getCurrentConversationPromptFlow]);

  const runConversationPromptFlow = useCallback((flow: ConversationPromptFlow): Promise<boolean> => {
    if (flow.promise) return flow.promise;
    const current = () => conversationPromptFlowRef.current === flow &&
      flow.generation === conversationNavigationRef.current && flow.conversationId === conversationIdRef.current;
    if (!current()) return Promise.resolve(false);
    if (flow.conversationId && flow.savedRevision === flow.revision) return Promise.resolve(true);
    flow.promise = (async () => {
      let created: import('../shared/types').StoredConversation | undefined;
      try {
        if (flow.predecessor) {
          await flow.predecessor;
          flow.predecessor = null;
          if (!current()) return false;
        }
        if (!flow.conversationId) {
          const result = await window.electron.createConversation?.();
          if (!result?.success || !result.data?.id) throw new Error(result?.error || 'Could not create conversation');
          created = result.data;
          if (deletedConversationIdsRef.current.has(created.id) || conversationPromptDeletionRef.current.has(created.id)) return false;
          if (!current()) { await cleanUnusedConversation(created); return false; }
          const replacement = created;
          const adopted = await activateConversation(replacement.id, flow.generation, drafts => {
            if (!current() || deletedConversationIdsRef.current.has(replacement.id) || conversationPromptDeletionRef.current.has(replacement.id)) return;
            migrateAttachmentDraft(conversationIdRef.current || 'new', replacement.id);
            conversationDraftsRef.current = drafts;
            flow.conversationId = replacement.id;
            pendingConversationPromptsRef.current.set(replacement.id, flow);
            knownConversationIdsRef.current.add(replacement.id);
            conversationIdRef.current = replacement.id;
            setConversationId(replacement.id);
            conversationSystemPromptRef.current = flow.prompt;
            setConversationSystemPrompt(flow.prompt);
            window.dispatchEvent(new CustomEvent('homebot:conversation-created', {
              detail: { ...replacement, messageCount: replacement.messages?.length || 0 },
            }));
          }, { preserveCurrentDraft: true });
          if (!adopted || flow.conversationId !== replacement.id) { await cleanUnusedConversation(replacement); return false; }
        }
        // Only one get/save pair runs at a time. Edits while a read is pending
        // supersede that read; edits during a save are written next from a fresh record.
        const owner = flow.conversationId!;
        // A captured record owns its autosave even after navigation. Only
        // adoption, UI and error reporting require the current editor scope.
        const ownsRecord = () => !deletedConversationIdsRef.current.has(owner);
        const write = (conversationPromptWritesRef.current.get(owner) || Promise.resolve()).then(async () => {
          while (ownsRecord() && !conversationPromptDeletionRef.current.has(owner) && flow.savedRevision !== flow.revision) {
            const revision = flow.revision;
            const result = await window.electron.getConversation?.(flow.conversationId!);
            if (!ownsRecord()) return false;
            if (conversationPromptDeletionRef.current.has(owner)) return false;
            if (revision !== flow.revision) continue;
            if (!result?.success || !result.data || result.data.id !== flow.conversationId) {
              throw new Error(result?.error || 'Could not load conversation');
            }
            const saved = await window.electron.saveConversation?.({ ...result.data, systemPrompt: flow.prompt });
            if (saved?.success !== true) throw new Error(saved?.error || 'Could not save conversation guidelines');
            flow.savedRevision = revision;
          }
          if (flow.savedRevision === flow.revision && pendingConversationPromptsRef.current.get(owner) === flow) {
            pendingConversationPromptsRef.current.delete(owner);
          }
          return current() && flow.savedRevision === flow.revision;
        });
        const barrier = write.then(() => undefined, () => undefined);
        conversationPromptWritesRef.current.set(owner, barrier);
        try { return await write; }
        finally {
          if (conversationPromptWritesRef.current.get(owner) === barrier) conversationPromptWritesRef.current.delete(owner);
        }
      } catch (error) {
        console.error('Could not save conversation guidelines:', error);
        if (created && flow.conversationId !== created.id) await cleanUnusedConversation(created);
        if (current()) addToast(flow.purpose === 'draft'
          ? 'Could not open a chat to keep this draft. Your text and attachments are kept. Please try again.'
          : flow.conversationId
            ? 'Could not save these chat guidelines. Your edits are kept. Edit them again or retry your message.'
            : 'Could not open a chat for these guidelines. Your edits are kept. Edit them again or retry your message.', 'error', 0);
        return false;
      } finally {
        flow.promise = null;
      }
    })();
    return flow.promise;
  }, [activateConversation, cleanUnusedConversation, addToast, migrateAttachmentDraft]);

  const updateConversationSystemPrompt = useCallback((prompt: string) => {
    let flow = getCurrentConversationPromptFlow();
    const owner = conversationIdRef.current;
    const generation = conversationNavigationRef.current;
    // Keep unsaved editor text in memory without evicting another chat's work.
    const otherPending = [...pendingConversationPromptsRef.current.entries()].filter(([id]) => id !== owner);
    const bytes = otherPending.reduce((total, [, pending]) => total + pending.prompt.length * 2, prompt.length * 2);
    if (otherPending.length >= 16 || prompt.length * 2 > 128 * 1024 || bytes > 512 * 1024) {
      addToast('These guidelines exceed the limit for unsaved edits. Your previous text is kept. Save or shorten existing guidelines before adding more.', 'warning', 0);
      return;
    }
    conversationSystemPromptRef.current = prompt;
    setConversationSystemPrompt(prompt);
    if (!flow || flow.generation !== generation || flow.conversationId !== owner) {
      flow = { generation, originConversationId: owner, conversationId: owner, prompt, revision: 0, savedRevision: -1, promise: null };
      conversationPromptFlowRef.current = flow;
    } else {
      flow.prompt = prompt;
      flow.revision += 1;
    }
    flow.purpose = undefined;
    if (owner) pendingConversationPromptsRef.current.set(owner, flow);
    if (!owner || !conversationPromptDeletionRef.current.has(owner)) void runConversationPromptFlow(flow);
  }, [getCurrentConversationPromptFlow, runConversationPromptFlow, addToast]);

  const handleNewConversation = async () => {
    const preparation = ++conversationNavigationPreparationRef.current;
    if (!prepareDraftNavigation().allowed) return;
    if (!conversationIdRef.current && (composerDraftRef.current.text || composerDraftRef.current.images.length ||
        composerDraftRef.current.documents.length || getCurrentConversationPromptFlow()?.hasSubmission || hasPendingNullAttachments())) {
      if (!await runConversationPromptFlow(getOrCreateNullConversationFlow())) return;
      if (preparation !== conversationNavigationPreparationRef.current || !prepareDraftNavigation().allowed) return;
    }
    const generation = ++conversationNavigationRef.current;
    let created: import('../shared/types').StoredConversation | undefined;
    try {
      const result = await window.electron.createConversation?.();
      if (!result?.success || !result.data) throw new Error(result?.error || 'Could not create conversation');
      created = result.data;
      if (generation !== conversationNavigationRef.current) { await cleanUnusedConversation(created); return; }
      if (result?.success && result.data) {
        const newConversation = result.data;
        const adopted = await activateConversation(newConversation.id, generation, drafts => {
          conversationDraftsRef.current = drafts;
          const nextDraft = createEmptyComposerDraft();
          composerDraftRef.current = nextDraft;
          setComposerDraft(nextDraft);
          knownConversationIdsRef.current.add(newConversation.id);
          conversationIdRef.current = newConversation.id;
          setConversationId(newConversation.id);
          conversationSystemPromptRef.current = newConversation.systemPrompt || '';
          setConversationSystemPrompt(newConversation.systemPrompt || '');
          setMessages([]);
          window.dispatchEvent(new CustomEvent('homebot:conversation-created', {
            detail: {
              ...newConversation,
              messageCount: newConversation.messages?.length || 0,
            }
          }));
        });
        if (!adopted) await cleanUnusedConversation(created);
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
      if (created) await cleanUnusedConversation(created);
      if (generation === conversationNavigationRef.current) addToast('Could not start a new conversation. Your draft is kept. Please try again.', 'error');
    }
  };
  newConversationRef.current = handleNewConversation;

  /**
   * Handle selecting a different conversation
   */
  const handleSelectConversation = async (id: string, scrollToMessageId?: string) => {
    if (unusedConversationCleanupRef.current.has(id)) {
      addToast('This unused chat is being removed. Choose another conversation.', 'warning', 8000);
      return;
    }
    const preparation = ++conversationNavigationPreparationRef.current;
    if (!prepareDraftNavigation(id).allowed) return;
    // Protect selection intent before any awaited read can race cleanup.
    knownConversationIdsRef.current.add(id);
    if (!conversationIdRef.current && (composerDraftRef.current.text || composerDraftRef.current.images.length ||
        composerDraftRef.current.documents.length || getCurrentConversationPromptFlow()?.hasSubmission || hasPendingNullAttachments())) {
      if (!await runConversationPromptFlow(getOrCreateNullConversationFlow())) return;
      if (preparation !== conversationNavigationPreparationRef.current || !prepareDraftNavigation(id).allowed) return;
    }
    const generation = ++conversationNavigationRef.current;
    try {
      const replyOwners = new Map(Array.from(streamRepliesRef.current.entries())
        .filter(([, reply]) => reply.conversationId === id));
      const convData = await window.electron.getConversation?.(id);
      if (generation !== conversationNavigationRef.current) return;
      if (!convData?.success || !convData.data) throw new Error(convData?.error || 'Could not load conversation');
      if (convData?.success && convData.data) {
        const selectedConversation = convData.data;
        await activateConversation(id, generation, drafts => {
          const nextDraft = id === conversationIdRef.current ? composerDraftRef.current
            : conversationDraftsRef.current.get(id) || createEmptyComposerDraft();
          conversationDraftsRef.current = drafts;
          composerDraftRef.current = nextDraft;
          setComposerDraft(nextDraft);

          // Convert stored messages to ChatMessage format
          for (const [messageId, reply] of streamRepliesRef.current) {
            if (reply.conversationId === id) replyOwners.set(messageId, reply);
          }
          const loadedMsgs: ChatMessage[] = selectedConversation.messages.map((m: SharedMessage) => ({
            id: m.id ?? newId(),
            role: m.role as any,
            content: m.content,
            createdAt: Date.parse(m.timestamp) || Date.now(),
            streamingState: (m.streamingState as any) || undefined,
            error: typeof (m as any).error === 'string' ? (m as any).error : ((m as any).error ? 'error' : null),
            ...(replyOwners.get(m.id || '')?.message || {}),
          }));
          for (const [messageId, reply] of replyOwners) {
            if (!loadedMsgs.some(message => message.id === messageId)) loadedMsgs.push({ ...reply.message });
          }
          // Viewing a saved reply must preserve its title without another model call.
          // A conversation with no completed reply can still get its first title.
          if (loadedMsgs.some(m => m.role === 'assistant' && m.content &&
            (!m.streamingState || m.streamingState === 'finished'))) {
            titleGeneratedRef.current.add(id);
          }
          conversationIdRef.current = id;
          setConversationId(id);
          const pendingPrompt = pendingConversationPromptsRef.current.get(id);
          const selectedPrompt = pendingPrompt ? pendingPrompt.prompt : selectedConversation.systemPrompt || '';
          if (pendingPrompt) {
            const restoredFlow = { generation, originConversationId: id, conversationId: id,
              prompt: selectedPrompt, revision: 0, savedRevision: -1, promise: null };
            conversationPromptFlowRef.current = restoredFlow;
            pendingConversationPromptsRef.current.set(id, restoredFlow);
            addToast('These chat guidelines have not been saved. Your edits are kept; edit them again or send a message to retry.', 'warning');
          }
          conversationSystemPromptRef.current = selectedPrompt;
          setConversationSystemPrompt(selectedPrompt);
          setMessages(loadedMsgs);

          // Scroll to the target message after render
          if (scrollToMessageId) {
            requestAnimationFrame(() => {
              setTimeout(() => {
                const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  el.classList.add('search-flash');
                  setTimeout(() => el.classList.remove('search-flash'), 2000);
                }
              }, 100);
            });
          }
        });
      }
    } catch (err) {
      console.error('Failed to load conversation:', err);
      if (generation === conversationNavigationRef.current) addToast('Could not open that conversation. Your draft is kept. Please try again.', 'error');
    }
  };

  /**
   * Handle deleting a conversation
   */
  const handleDeleteConversation = async (id: string) => {
    conversationPromptDeletionRef.current.add(id);
    try {
      // Guidelines and reply recovery writes settle before deletion, preventing
      // a late full-record save or missing-row repair from recreating the record.
      const promptWrite = conversationPromptWritesRef.current.get(id);
      if (promptWrite) await promptWrite;
      const result = await window.electron.deleteConversation?.(id);
      if (!result?.success) throw new Error(result?.error || 'Could not delete this conversation. Please try again.');
      conversationDraftsRef.current.delete(id);
      pendingConversationPromptsRef.current.delete(id);
      deletedConversationIdsRef.current.add(id);
      for (const [streamId, confirmation] of stoppedStreamConfirmationsRef.current) {
        if (confirmation.conversationId !== id) continue;
        unsubscribeStream(streamId);
        stoppedStreamConfirmationsRef.current.delete(streamId);
      }
      invalidateAttachmentDraft(id);
      setUnsavedReplyIds(previous => previous.filter(streamId => streamRepliesRef.current.get(streamId)?.conversationId !== id));
      for (const [streamId, reply] of streamRepliesRef.current) {
        if (reply.conversationId !== id) continue;
        reply.terminal = true;
        streamRepliesRef.current.delete(streamId);
        const subscription = streamSubsRef.current.get(streamId);
        try { subscription?.unsubscribe(); } catch {}
        streamSubsRef.current.delete(streamId);
        const watcher = streamWatchersRef.current.get(streamId);
        if (watcher) clearTimeout(watcher);
        streamWatchersRef.current.delete(streamId);
        try { window.electron.cancelStream?.(streamId); } catch {}
      }
      for (const [messageId, request] of retryRequestsRef.current) {
        if (request.conversation_id === id) retryRequestsRef.current.delete(messageId);
      }
      const remainingHeld = heldSubmissionsRef.current.filter(scope => scope.conversationId !== id);
      heldSubmissionsRef.current = remainingHeld;
      setHeldSubmissions(remainingHeld);
      
      // Clear the deleted conversation only after the backend acknowledges it.
      // The next message can create its replacement without hiding a failed delete.
      if (id === conversationIdRef.current) {
        const nextDraft = createEmptyComposerDraft();
        composerDraftRef.current = nextDraft;
        setComposerDraft(nextDraft);
        setMessages([]);
        conversationIdRef.current = null;
        setConversationId(null);
        conversationSystemPromptRef.current = '';
        setConversationSystemPrompt('');
      }
      return { success: true };
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Could not delete this conversation. Please try again.' };
    } finally {
      conversationPromptDeletionRef.current.delete(id);
    }
  };


  /**
   * Send message to HomeBot orchestrator
   */
  const unsubscribeStream = useCallback((streamId: string) => {
    const subs = streamSubsRef.current.get(streamId);
    if (subs) {
      try { subs.unsubscribe(); } catch {}
      streamSubsRef.current.delete(streamId);
    }
  }, []);

  const subscribeToStream = useCallback((streamId: string, seed: ChatMessage, requestConversationId: string,
    placeholderSaved: Promise<boolean> = Promise.resolve(true)) => {
    if (stoppedStreamConfirmationsRef.current.has(streamId)) unsubscribeStream(streamId);
    stoppedStreamConfirmationsRef.current.delete(streamId);
    if (streamSubsRef.current.has(streamId)) return;
    const stopToken = Symbol(streamId);
    const assistantId = seed.id;
    const reply: StreamReply = {
      conversationId: requestConversationId, message: { ...seed }, placeholderSaved,
      terminal: false, saving: false, save: async () => {}, finish: () => {}, stop: () => {},
    };
    streamRepliesRef.current.set(streamId, reply);
    setUnsavedReplyIds(previous => previous.filter(id => id !== streamId));
    const publish = () => {
      if (deletedConversationIdsRef.current.has(requestConversationId)) return;
      const snapshot = reply.message;
      setMessages(previous => conversationIdRef.current !== requestConversationId ? previous
        : previous.map(message => message.id === assistantId ? { ...message, ...snapshot } : message));
    };
    reply.save = async (repair = false) => {
      if (reply.saving || streamRepliesRef.current.get(streamId) !== reply || deletedConversationIdsRef.current.has(requestConversationId)) return;
      reply.saving = true;
      let saved = false;
      const ownsRecord = () => streamRepliesRef.current.get(streamId) === reply &&
        !deletedConversationIdsRef.current.has(requestConversationId) && !conversationPromptDeletionRef.current.has(requestConversationId);
      const write = (conversationPromptWritesRef.current.get(requestConversationId) || Promise.resolve()).then(async () => {
        const placeholderExists = await reply.placeholderSaved;
        if (!ownsRecord() || (!placeholderExists && !repair)) return false;
        if (repair) {
          // Confirm the chat and inspect an uncertain add acknowledgement before
          // repairing a row. The deletion barrier also owns this explicit write.
          const record = await window.electron.getConversation?.(requestConversationId);
          if (!ownsRecord() || record?.success !== true || record.data?.id !== requestConversationId) return false;
          if (!record.data.messages.some(message => message.id === assistantId)) return persistMessage(reply.message, requestConversationId);
        }
        return updatePersistedMessage(assistantId, {
          content: reply.message.content,
          streamingState: reply.message.streamingState === 'cancelling' ? 'cancelled' : reply.message.streamingState,
          error: !!reply.message.error,
        }, requestConversationId);
      });
      const barrier = write.then(() => undefined, () => undefined);
      conversationPromptWritesRef.current.set(requestConversationId, barrier);
      try {
        saved = await write;
      } catch (error) {
        console.error('Could not finish saving the reply:', error);
      } finally {
        if (conversationPromptWritesRef.current.get(requestConversationId) === barrier) conversationPromptWritesRef.current.delete(requestConversationId);
        reply.saving = false;
        if (streamRepliesRef.current.get(streamId) === reply) {
          if (saved || deletedConversationIdsRef.current.has(requestConversationId)) {
            streamRepliesRef.current.delete(streamId);
            setUnsavedReplyIds(previous => previous.filter(id => id !== streamId));
          } else {
            reply.failed = true;
            setUnsavedReplyIds(previous => previous.includes(streamId) ? previous : [...previous, streamId]);
            addToast('This reply could not be saved. Open its original chat to copy it or retry saving before closing HomeBot.', 'error', 10000);
          }
        }
      }
    };
    reply.finish = updates => {
      if (reply.terminal) return;
      reply.terminal = true;
      const watcher = streamWatchersRef.current.get(streamId);
      if (watcher) clearTimeout(watcher);
      streamWatchersRef.current.delete(streamId);
      reply.message = { ...reply.message, ...updates, updatedAt: Date.now() };
      publish();
      if (stoppedStreamConfirmationsRef.current.get(streamId)?.token !== stopToken) unsubscribeStream(streamId);
      void reply.save();
    };
    reply.stop = () => {
      if (reply.terminal) return;
      const confirmations = stoppedStreamConfirmationsRef.current;
      confirmations.set(streamId, { conversationId: requestConversationId, token: stopToken });
      if (confirmations.size > 8) {
        const oldestId = confirmations.keys().next().value!;
        unsubscribeStream(oldestId);
        confirmations.delete(oldestId);
      }
      reply.finish({ streamingState: 'cancelled' });
    };
    // Reserve ownership before registering callbacks, including a synchronous end.
    streamSubsRef.current.set(streamId, { unsubscribe: () => {} });
    const unsubscribe = window.electron.subscribeToStream?.(streamId, {
      onStreamChunk: (payload: { streamId?: string; chunk: string }) => {
        if (reply.terminal || deletedConversationIdsRef.current.has(requestConversationId)) return;
        const marker = '\n___REPLACE___';
        reply.message = { ...reply.message,
          content: payload.chunk.startsWith(marker) ? payload.chunk.slice(marker.length) : reply.message.content + payload.chunk,
          updatedAt: Date.now(),
        };
        publish();
      },
      onStreamEnd: (payload: { streamId?: string; cancelled?: boolean; model?: string }) => {
        if (reply.terminal) {
          const confirmation = stoppedStreamConfirmationsRef.current.get(streamId);
          const ownsConfirmation = () => stoppedStreamConfirmationsRef.current.get(streamId)?.token === stopToken &&
            !deletedConversationIdsRef.current.has(requestConversationId) &&
            !conversationPromptDeletionRef.current.has(requestConversationId) &&
            (!streamRepliesRef.current.has(streamId) || streamRepliesRef.current.get(streamId) === reply);
          if (!confirmation || confirmation.reconciling || !ownsConfirmation()) return;
          confirmation.reconciling = true;
          unsubscribeStream(streamId);
          // This corrects status only: stopped content remains immutable, and a
          // prior generation cannot replace a same-ID Retry's result.
          reply.message = { ...reply.message, streamingState: payload.cancelled ? 'cancelled' : 'finished',
            ...(!payload.cancelled ? { durationMs: Date.now() - reply.message.createdAt } : {}),
            ...(payload.model ? { model: payload.model } : {}),
          };
          publish();
          try {
            (window as any).__e2eEvents = (window as any).__e2eEvents || [];
            (window as any).__e2eEvents.push('homebot:stream-end');
            if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received homebot:stream-end', payload);
          } catch {}
          const write = (conversationPromptWritesRef.current.get(requestConversationId) || Promise.resolve()).then(async () => {
            if (!ownsConfirmation()) return;
            const saved = await updatePersistedMessage(assistantId, {
              streamingState: payload.cancelled ? 'cancelled' : 'finished',
            }, requestConversationId);
            if (!saved && ownsConfirmation() && !reply.failed) {
              addToast('Your partial reply is kept, but its final status could not be saved.', 'warning', 10000);
            }
          });
          const barrier = write.then(() => undefined, () => undefined);
          conversationPromptWritesRef.current.set(requestConversationId, barrier);
          void barrier.finally(() => {
            if (conversationPromptWritesRef.current.get(requestConversationId) === barrier) conversationPromptWritesRef.current.delete(requestConversationId);
            if (stoppedStreamConfirmationsRef.current.get(streamId)?.token === stopToken) stoppedStreamConfirmationsRef.current.delete(streamId);
          });
          return;
        }
        const leaked = payload.cancelled ? [] : detectLeakedToolCalls(reply.message.content);
        const content = leaked.length > 0
          ? stripLeakedToolCalls(reply.message.content) + '\n\n⚠️ ' + describeLeak(leaked)
          : reply.message.content;
        reply.finish({ content, streamingState: payload.cancelled ? 'cancelled' : 'finished',
          ...(!payload.cancelled ? { durationMs: Date.now() - reply.message.createdAt } : {}),
          ...(payload.model ? { model: payload.model } : {}),
        });
        try {
          (window as any).__e2eEvents = (window as any).__e2eEvents || [];
          (window as any).__e2eEvents.push('homebot:stream-end');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received homebot:stream-end', payload);
        } catch {}
      },
      onStreamError: (payload: { streamId?: string; error?: string; message?: string; recoveryHint?: any }) => {
        try {
          const diagnostic = (payload as any)?.diagnostic;
          if (diagnostic) {
            console.error(`[STREAM ERROR] url=${diagnostic.url} error=${diagnostic.errorText} n8nResponded=${diagnostic.n8nResponded} httpStatus=${diagnostic.httpStatus}`);
            try { (window as any).homebotCapture?.log(`[Renderer] STREAM ERROR url=${diagnostic.url} status=${diagnostic.httpStatus} n8nResponded=${diagnostic.n8nResponded}`); } catch {}
            if (!reply.terminal) {
              setBackendDiagnostic(typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic, null, 2));
              setStatus(previous => ({ ...previous, n8n: 'offline' }));
            }
          }
        } catch {}
        if (reply.terminal) return;
        const error = payload.recoveryHint?.userMessage || payload.message ||
          (typeof payload.error === 'string' ? payload.error : undefined) || 'Something went wrong.';
        reply.finish({ streamingState: 'error', error, recoveryHint: payload.recoveryHint || null });
        try {
          (window as any).__e2eEvents = (window as any).__e2eEvents || [];
          (window as any).__e2eEvents.push('homebot:stream-error');
          if ((window as any).__e2eMode) console.log('[E2E-TRACE] renderer received homebot:stream-error', payload);
        } catch {}
      },
    });
    if (reply.terminal) { try { unsubscribe?.(); } catch {} }
    else streamSubsRef.current.set(streamId, { unsubscribe: unsubscribe ?? (() => {}) });
  }, [addToast, unsubscribeStream, updatePersistedMessage, persistMessage]);

  const rememberRetryRequest = useCallback((assistantId: string, request: HomeBotRequestWithImages) => {
    retainRetryRequest(retryRequestsRef.current, assistantId, request);
  }, []);

  const releaseSubmissionCreation = useCallback((scope: SubmissionScope) => {
    streamReplyReservationsRef.current.delete(scope.id);
    if (!scope.creationPending || !scope.creationFlow) return;
    scope.creationPending = false;
    const flow = scope.creationFlow;
    flow.pendingSubmissions = Math.max(0, (flow.pendingSubmissions || 1) - 1);
    flow.hasSubmission = flow.pendingSubmissions > 0;
  }, []);
  const preserveStoppedSubmission = useCallback((scope: SubmissionScope, message = 'This request was not sent because you changed conversations. Its draft is kept in the original conversation.') => {
    if (scope.retained) return;
    scope.retained = true;
    releaseSubmissionCreation(scope);
    // Successful deletion includes unsent work from this conversation, even
    // when an earlier validation finishes after the deletion acknowledgement.
    if (scope.conversationId && deletedConversationIdsRef.current.has(scope.conversationId)) return;
    if (scope.committed) {
      // The user turn is already durable. Restoring it as an unsent draft would
      // duplicate it on Send; offer Retry against that same turn instead.
      if (scope.conversationId && scope.assistantId && !deletedConversationIdsRef.current.has(scope.conversationId)) {
        const recovery: ChatMessage = {
          id: scope.assistantId, role: 'assistant', createdAt: Date.now(), streamingState: 'error',
          content: 'Your request is saved here. It was not sent because you changed conversations. Choose Retry to continue.',
          error: 'Request saved but not sent.',
        };
        setMessages(previous => conversationIdRef.current === scope.conversationId ? [...previous, recovery] : previous);
        void persistMessage(recovery, scope.conversationId).then(saved => {
          if (!saved) {
            addToast('Your request is saved, but HomeBot could not save its Retry control. Return to the original chat to review it.', 'error', 0);
          } else {
            setMessages(previous => conversationIdRef.current === scope.conversationId && !previous.some(row => row.id === recovery.id)
              ? [...previous, recovery] : previous);
          }
        });
        addToast('Your request is saved in its original chat. Return there and choose Retry to continue.', 'warning', 8000);
      }
      return;
    }
    const current = scope.conversationId === conversationIdRef.current;
    const stored = current ? composerDraftRef.current : conversationDraftsRef.current.get(scope.conversationId || 'new');
    const recoveryRetention = !current ? prepareInactiveDraftRetention(conversationDraftsRef.current, {
      key: scope.conversationId || 'new', draft: scope.draft,
    }) : null;
    if ((scope.conversationId !== null || current) && (!stored || (!stored.text && !stored.images.length && !stored.documents.length)) &&
        (current || recoveryRetention?.allowed)) {
      if (current) {
        composerDraftRef.current = scope.draft;
        setComposerDraft(scope.draft);
      } else {
        if (recoveryRetention?.allowed) conversationDraftsRef.current = recoveryRetention.nextDrafts;
      }
      addToast(message, 'warning', 8000);
      return;
    }
    const size = (item: SubmissionScope) => 2 * (
      item.draft.text.length + [...item.draft.images, ...item.draft.documents]
        .reduce((total, attachment) => total + Object.values(attachment).reduce<number>((sum, value) => sum + (typeof value === 'string' ? value.length : 0), 0), 0)
    );
    const retained = heldSubmissionsRef.current;
    if (retained.length >= 8 || size(scope) + retained.reduce((total, item) => total + size(item), 0) > 32 * 1024 * 1024) {
      addToast('Your earlier request was not sent and the temporary recovery buffer is full. Your newer draft is kept. Reattach the original files and write that earlier request again.', 'error', 0);
      return;
    }
    const next = [...retained, scope];
    heldSubmissionsRef.current = next;
    setHeldSubmissions(next);
    addToast('Your earlier request was not sent. Your newer draft is kept. Return to its conversation and clear or send the newer draft to restore the held request.', 'warning', 8000);
  }, [addToast, persistMessage, releaseSubmissionCreation]);

  const guardSubmission = useCallback((scope: SubmissionScope) => {
    const originalFlow = scope.creationFlow || conversationPromptFlowRef.current;
    const promptFlow = getCurrentConversationPromptFlow();
    // Lazy guideline creation adopts the same previously empty chat. It is
    // not explicit navigation, so an already prepared Send still owns it.
    const owningFlow = originalFlow?.generation === scope.generation ? originalFlow : promptFlow;
    if (scope.conversationId === null && owningFlow?.generation === scope.generation && owningFlow.originConversationId === null) {
      scope.creationFlow = owningFlow;
      if (owningFlow.conversationId) scope.conversationId = owningFlow.conversationId;
    }
    if (scope.generation === conversationNavigationRef.current && scope.conversationId === conversationIdRef.current) return true;
    preserveStoppedSubmission(scope);
    return false;
  }, [getCurrentConversationPromptFlow, preserveStoppedSubmission]);

  useEffect(() => {
    if (pendingModelSuggestion && !guardSubmission(pendingModelSuggestion.scope)) {
      setPendingModelSuggestion(null);
    }
  }, [pendingModelSuggestion, conversationId, guardSubmission]);

  const restoreHeldSubmission = (scope: SubmissionScope) => {
    const current = composerDraftRef.current;
    if (current.text || current.images.length || current.documents.length) return;
    invalidateAttachmentDraft(conversationIdRef.current || 'new');
    composerDraftRef.current = scope.draft;
    setComposerDraft(scope.draft);
    const next = heldSubmissionsRef.current.filter(item => item.id !== scope.id);
    heldSubmissionsRef.current = next;
    setHeldSubmissions(next);
    addToast('Request restored. Review it, then choose Send.', 'info');
  };
  const currentHeldSubmission = heldSubmissions.find(item => item.conversationId === conversationId || item.conversationId === null);

  const dispatchMessage = useCallback(async (
    text: string,
    messageText: string,
    images?: ImageAttachment[] | null,
    documents?: DocumentAttachment[] | null,
    modelOverride?: string,
    submission?: SubmissionScope,
  ) => {
    if (!text && (!images || images.length === 0) && (!documents || documents.length === 0)) return;
    const scope = submission || {
      id: newId(), generation: conversationNavigationRef.current, conversationId: conversationIdRef.current,
      draft: { text, images: (images || []).map(image => ({ ...image, id: (image as { id?: string }).id || newId() })), documents: documents || [] },
    };
    if (!guardSubmission(scope)) return;

    // Keep at most eight live/unsaved reply owners without evicting a recovery
    // copy. A ninth request remains editable until an earlier reply is saved.
    if (streamRepliesRef.current.size + streamReplyReservationsRef.current.size >= 8) {
      await Promise.resolve(); // Let the originating composer complete Send's reset.
      preserveStoppedSubmission(scope, 'Eight replies are still running or waiting to be saved. Finish or save an earlier reply, then send this kept draft again.');
      return;
    }
    streamReplyReservationsRef.current.add(scope.id);

    // Even an older editor scope's already-issued full-record save must finish
    // before this conversation gains a user turn (including A → B → A).
    const outstandingPromptWrite = scope.conversationId && conversationPromptWritesRef.current.get(scope.conversationId);
    if (outstandingPromptWrite) {
      await outstandingPromptWrite;
      if (!guardSubmission(scope)) return;
    }
    const promptFlow = scope.conversationId ? getCurrentConversationPromptFlow() : getOrCreateNullConversationFlow();
    if (promptFlow && promptFlow.generation === scope.generation && promptFlow.conversationId === scope.conversationId &&
        (!promptFlow.conversationId || promptFlow.savedRevision !== promptFlow.revision)) {
      if (!scope.conversationId) scope.creationFlow = promptFlow;
      const saved = await runConversationPromptFlow(promptFlow);
      if (!guardSubmission(scope)) return;
      if (!saved) {
        preserveStoppedSubmission(scope, promptFlow.purpose === 'draft'
          ? 'This request was not sent because HomeBot could not open a conversation. Your draft is kept. Please try again.'
          : 'This request was not sent because its chat guidelines could not be saved. Your message is kept. Retry after saving the guidelines.');
        return;
      }
    }

    const activeConvId = scope.conversationId;

    if (!guardSubmission(scope)) return;
    // Add user message
    const userId = newId();
    const userMsg: ChatMessage = {
      id: userId,
      role: 'user',
      content: messageText,
      createdAt: Date.now(),
      ...(images && images.length > 0
        ? { images: images.map(img => ({ url: img.url || img.dataUrl || (img.data ? `data:${img.mimeType || 'image/png'};base64,${img.data}` : ''), filename: img.filename })).filter(i => i.url) }
        : {}),
    };
    const assistantId = newId();
    scope.assistantId = assistantId;
    const streamRequest: HomeBotRequestWithImages & { streamId?: string } = {
      user_id: 'desktop_user', conversation_id: activeConvId || conversationId || 'default',
      message: messageText, timestamp: new Date().toISOString(),
      conversationPrompt: conversationSystemPromptRef.current || undefined, modelOverride,
      ...(images?.length ? { images, ...(images.length === 1 ? { image: images[0] } : {}) } : {}),
      ...(documents?.length ? { documents } : {}),
    };
    rememberRetryRequest(assistantId, streamRequest);
    setMessages(prev => [...prev, userMsg]);
    scope.committed = await persistMessage(userMsg, activeConvId ?? undefined);
    if (!guardSubmission(scope)) return;

    if (messages.length === 0 && (activeConvId || conversationId) && text) {
      const cleaned = text
        .replace(/^(what('?s| is| are| were)?|who('?s| is| are)?|how('?s| is| are| do| does)?|can you|could you|please|tell me|show me|give me|do you know|i want to know)\s+/i, '')
        .replace(/\bin the nba\b/i, 'NBA')
        .replace(/\btoday\b/i, 'today')
        .trim();
      const titleSource = cleaned || text;
      const autoTitle = titleSource.length > 45 ? titleSource.slice(0, 45).trimEnd() + '…' : titleSource;
      const finalTitle = autoTitle.charAt(0).toUpperCase() + autoTitle.slice(1);
      try {
        const convData = await window.electron.getConversation?.(activeConvId || conversationId || '');
        if (!guardSubmission(scope)) return;
        if (convData?.success && convData.data) {
          await (window as any).electron.saveConversation?.({
            ...convData.data,
            title: finalTitle,
          });
          if (!guardSubmission(scope)) return;
        }
      } catch (err) {
        console.error('Failed to auto-title conversation:', err);
      }
    }

    if (!guardSubmission(scope)) return;
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      streamingState: 'streaming'
    };
    setMessages(prev => [...prev, assistantPlaceholder]);
    const placeholderSaved = persistMessage(assistantPlaceholder, activeConvId ?? undefined);
    subscribeToStream(assistantId, assistantPlaceholder, streamRequest.conversation_id, placeholderSaved);
    streamReplyReservationsRef.current.delete(scope.id);

    try {
      logDebug('[Renderer] Sending stream request', { streamId: assistantId, payload: streamRequest });
      try { (window as any).homebotCapture?.log(`[Renderer] Sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({ ...streamRequest, streamId: assistantId });
      if (process.env.NODE_ENV === 'test' && streamRepliesRef.current.get(assistantId)?.terminal === false) {
        const timeoutMs = Number(process.env.HOMEBOT_E2E_PROBE_TIMEOUT_MS) || 6000;
        try {
          const t = setTimeout(() => {
            try { (window as any).__homebot_error_received = true; (window as any).__homebot_error_event = { error: 'probe_timeout', streamId: assistantId }; } catch (e) {}
            streamRepliesRef.current.get(assistantId)?.finish({ streamingState: 'error', error: 'Upstream error (probe timeout)' });
          }, timeoutMs);
          streamWatchersRef.current.set(assistantId, t);
        } catch (e) {}
      }
    } catch (err: any) {
      console.error(err);
      streamRepliesRef.current.get(assistantId)?.finish({ streamingState: 'error', error: err?.message ?? 'Failed to send' });
      if (process.env.NODE_ENV === 'test') {
        try { (window as any).__homebot_error_received = true; (window as any).__homebot_error_event = err; } catch (e) {}
      }
      unsubscribeStream(assistantId);
    }
    releaseSubmissionCreation(scope);
  }, [conversationId, messages.length, newId, persistMessage, subscribeToStream, unsubscribeStream, updateMessage, guardSubmission, preserveStoppedSubmission, rememberRetryRequest, getCurrentConversationPromptFlow, getOrCreateNullConversationFlow, runConversationPromptFlow, releaseSubmissionCreation]);

  const handleSendMessage = useCallback(async (content: string, images?: ImageAttachment[] | null, documents?: DocumentAttachment[] | null) => {
    const text = content?.trim() ?? '';
    if (!text && (!images || images.length === 0) && (!documents || documents.length === 0)) return;
    invalidateAttachmentDraft(conversationIdRef.current || 'new');
    const scope: SubmissionScope = {
      id: newId(), generation: conversationNavigationRef.current, conversationId: conversationIdRef.current,
      draft: { text: content, images: (images || []).map(image => ({ ...image, id: (image as { id?: string }).id || newId() })), documents: documents || [] },
    };
    if (!scope.conversationId) {
      scope.creationFlow = getOrCreateNullConversationFlow();
      scope.creationPending = true;
      scope.creationFlow.pendingSubmissions = (scope.creationFlow.pendingSubmissions || 0) + 1;
      scope.creationFlow.hasSubmission = true;
    }

    let messageText = text;
    if (images && images.length > 0) {
      const imageInfo = images.map(image => `[Image attached: ${image.filename || 'image'}]`).join('\n');
      messageText = imageInfo + (text ? '\n\n' + text : '\n\nPlease describe this image.');
    }
    if (documents && documents.length > 0) {
      const docInfo = documents.map(d => `[Document attached: ${d.filename}]`).join('\n');
      messageText = docInfo + (messageText ? '\n\n' + messageText : '\n\nPlease analyze this document.');
    }

    let modelOverride: string | undefined;
    if (!settings.useCustomLLM) {
      try {
        const res = await window.electron?.listOllamaModels?.();
        if (!guardSubmission(scope)) return;
        if (res?.success) {
          const modelRoutingMode = settings.modelRoutingMode || 'prompt';
          const recommendation = recommendLocalModelForTask({
            message: text || messageText,
            installedModels: (res.models || []).map((model: { name: string }) => model.name),
            chatModel: settings.chatModel,
            codeModel: settings.codeModel,
            visionModel: settings.visionModel,
            hasImages: !!images?.length,
            hasDocuments: !!documents?.length,
          });
          if (recommendation && modelRoutingMode !== 'off') {
            if (modelRoutingMode === 'auto') {
              modelOverride = recommendation.recommendedModel;
            } else if (modelRoutingMode === 'prompt') {
              setPendingModelSuggestion({
                text,
                messageText,
                images,
                documents,
                recommendation,
                scope,
              });
              return;
            }

            const tipKey = `${recommendation.task}:${recommendation.currentModel}:${recommendation.recommendedModel}`;
            if (lastModelTipRef.current !== tipKey) {
              lastModelTipRef.current = tipKey;
              addToast(
                modelRoutingMode === 'auto'
                  ? `Auto-switching this ${recommendation.task} request to ${recommendation.recommendedModel} instead of ${recommendation.currentModel}. ${recommendation.reason}`
                  : `Suggested for this ${recommendation.task} request: ${recommendation.recommendedModel} instead of ${recommendation.currentModel}. ${recommendation.reason}`,
                'info',
                8000,
              );
            }
          }
        }
      } catch {
        // Keep the request moving even if model inventory lookup fails.
      }
    }
    if (!guardSubmission(scope)) return;
    await dispatchMessage(text, messageText, images, documents, modelOverride, scope);
  }, [addToast, dispatchMessage, settings.chatModel, settings.codeModel, settings.modelRoutingMode, settings.useCustomLLM, settings.visionModel, newId, guardSubmission, getOrCreateNullConversationFlow, invalidateAttachmentDraft]);


  /**
   * Handle confirmation approval
   */
  const handleConfirmAction = () => {
    // Send confirmation response to main process
    if (pendingConfirmationData?.confirmationId) {
      window.electron.sendConfirmationResponse?.(pendingConfirmationData.confirmationId, true);
    }

    // Clear confirmation state
    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
  };

  const handleConfirmModelSuggestion = useCallback(async () => {
    if (!pendingModelSuggestion) return;
    const pending = pendingModelSuggestion;
    const newModel = pending.recommendation.recommendedModel;
    setPendingModelSuggestion(null);
    await dispatchMessage(
      pending.text,
      pending.messageText,
      pending.images,
      pending.documents,
      newModel,
      pending.scope,
    );
  }, [dispatchMessage, pendingModelSuggestion]);

  const retryMessage = useCallback(async (assistantId: string) => {
    const idx = messages.findIndex(m => m.id === assistantId);
    if (idx <= 0) return;
    const prevUser = messages[idx - 1];
    if (!prevUser || prevUser.role !== "user") return;
    const previousReply = streamRepliesRef.current.get(assistantId);
    if (previousReply?.saving || stoppedStreamConfirmationsRef.current.get(assistantId)?.reconciling) {
      addToast('This reply is still being saved. Wait for the save to finish before Retry; its text is kept.', 'warning', 8000);
      return;
    }
    if (previousReply?.failed) {
      const generation = conversationNavigationRef.current;
      const owner = conversationIdRef.current;
      await previousReply.save(true);
      if (generation !== conversationNavigationRef.current || owner !== conversationIdRef.current ||
          deletedConversationIdsRef.current.has(previousReply.conversationId)) return;
      if (streamRepliesRef.current.get(assistantId) === previousReply) return;
    }
    if (!streamRepliesRef.current.has(assistantId) && streamRepliesRef.current.size + streamReplyReservationsRef.current.size >= 8) {
      addToast('Eight replies are still running or waiting to be saved. Finish or save an earlier reply before Retry.', 'warning', 8000);
      return;
    }
    const hasDocumentAttachmentMarker = /\[document attached:/i.test(prevUser.content);
    const hasImageAttachment = !!prevUser.images?.length || /\[image attached:/i.test(prevUser.content);
    const originalRequest = retryRequestsRef.current.get(assistantId);

    // reset assistant bubble
    updateMessage(assistantId, m => ({
      ...m,
      content: "",
      error: null,
      streamingState: "streaming",
      createdAt: Date.now(),
      durationMs: undefined,
    }));

    if ((hasDocumentAttachmentMarker && !originalRequest?.documents?.length) ||
        (hasImageAttachment && !originalRequest?.images?.length)) {
      const needsImages = hasImageAttachment && !originalRequest?.images?.length;
      updateMessage(assistantId, m => ({
        ...m,
        streamingState: "error",
        error: needsImages
          ? 'The original image is no longer available for Retry. Reattach it and send the request again.'
          : 'The original document is no longer available for Retry. Reattach it and send the request again.',
        recoveryHint: {
          service: 'unknown',
          userMessage: needsImages ? 'Reattach the original image and send your request again.' : 'Reattach the original document and send your request again.',
          action: needsImages ? 'reattach-image' : 'reattach-document',
          actionLabel: needsImages ? 'Reattach image' : 'Reattach document',
        },
      }));
      return;
    }

    const retryConversationId = originalRequest?.conversation_id || conversationId || 'default';
    const retrySeed: ChatMessage = { ...messages[idx], content: '', error: null, streamingState: 'streaming',
      createdAt: Date.now(), durationMs: undefined };
    subscribeToStream(assistantId, retrySeed, retryConversationId);

    try {
      logDebug('[Renderer] Retry sending stream request', { streamId: assistantId, message: prevUser.content });
      try { (window as any).homebotCapture?.log(`[Renderer] Retry sending stream request streamId=${assistantId}`); } catch (e) {}
      await window.electron.sendStreamMessage?.({
        ...(originalRequest || { user_id: 'desktop_user', conversation_id: retryConversationId, message: prevUser.content }),
        message: prevUser.content,
        streamId: assistantId,
        timestamp: new Date().toISOString(),
        retry: true,
      });
    } catch (err: any) {
      streamRepliesRef.current.get(assistantId)?.finish({ streamingState: 'error', error: err?.message ?? 'Retry failed' });
      unsubscribeStream(assistantId);
    }
  }, [messages, subscribeToStream, unsubscribeStream, updateMessage, conversationId, addToast]);

  const handleUserCancel = (id: string) => {
    const reply = streamRepliesRef.current.get(id);
    if (reply) reply.stop();
    else setMessages(previous => previous.map(message => message.id === id ? { ...message, streamingState: 'cancelled' } : message));
    try { window.electron.cancelStream?.(id); } catch {}
  };

  // Toggle bookmark on a message
  const handleBookmark = useCallback((messageId: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, bookmarked: !m.bookmarked } : m
    ));
  }, []);

  // Toggle reaction on a message
  const handleReact = useCallback((messageId: string, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      const reactions = { ...(m.reactions || {}) };
      reactions[emoji] = reactions[emoji] ? 0 : 1;
      return { ...m, reactions };
    }));
  }, []);

  // Edit a user message
  const handleEdit = useCallback((messageId: string, newContent: string) => {
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: newContent, edited: true, updatedAt: Date.now() } : m
    ));
    // Persist the edit
    updatePersistedMessage(messageId, { content: newContent });
  }, [updatePersistedMessage]);

  // An idea brainstormed in chat becomes a Media Studio job, and the app
  // switches there so the creation is visible where the work will happen.
  const handleSendToMediaStudio = useCallback(async (message: ChatMessage) => {
    try {
      const input = chatIdeaToJobInput({ content: message.content || '', createdAt: message.createdAt });
      const res = await (window as any).electron?.mediaCreate?.(input);
      if (res && res.ok === false) {
        // A refusal the user cannot see is a click that did nothing.
        addToast(`Media Studio refused: ${res.error || 'unknown reason'}`, 'error');
        return;
      }
      if (res?.job?.id) {
        setNavContext({ jobId: res.job.id });
      }
      setMode('media');
    } catch (e: any) {
      addToast('Could not create the video job.', 'error');
    }
  }, [addToast]);

  /**
   * Handle confirmation rejection
   */
  const handleRejectAction = () => {
    // Send rejection response to main process
    if (pendingConfirmationData?.confirmationId) {
      window.electron.sendConfirmationResponse?.(pendingConfirmationData.confirmationId, false);
    }

    setMessages(prev => [...prev, {
      id: newId(),
      role: 'system',
      content: 'Action cancelled by user.',
      createdAt: Date.now(),
      error: null
    }]);

    setAwaitingConfirmation(false);
    setPendingToolCall(null);
    setPendingConfirmationData(null);
  };

  const handleRejectModelSuggestion = useCallback(async () => {
    if (!pendingModelSuggestion) return;
    const pending = pendingModelSuggestion;
    setPendingModelSuggestion(null);
    await dispatchMessage(
      pending.text,
      pending.messageText,
      pending.images,
      pending.documents,
      undefined,
      pending.scope,
    );
  }, [dispatchMessage, pendingModelSuggestion]);

  // canSend is handled by child InputBox; the renderer only needs to know hydration state

  const modeClasses = [
    'app-container',
    widgetMode ? 'widget-mode' : 'expanded-mode',
  ].filter(Boolean).join(' ');

  return (
    <div className={modeClasses} data-testid="homebot-app-root" data-hydrated={isHydrated ? "true" : undefined} data-theme={resolvedTheme} data-density={settings.messageDensity || 'comfortable'}>
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Custom frameless titlebar — shown in widget mode */}
      {widgetMode && (
        <div className="widget-titlebar">
          <div className="widget-titlebar-brand">
            <Logo className="header-logo" size={22} />
            <span className={`widget-status-dot${status.ollama === 'offline' ? ' disconnected' : ''}`} />
            <h1>HomeBot</h1>
          </div>
          <div className="widget-model-selector">
            <ModelSelector
              currentModel={activeModel.model || settings.chatModel || 'qwen2.5:7b'}
              customLLM={settings.customLLM}
              useCustomLLM={settings.useCustomLLM}
              providerApiKeys={settings.providerApiKeys}
              onModelChange={async (model: string, useCustom: boolean, provider?: string) => {
                // Cloud picks must carry their provider. Saving only the id left configs
                // like { provider: 'google-ai-studio', model: 'opus' } — Gemini's endpoint
                // asked for a Claude model, which fails and silently drops to local.
                // chatModel stays a LOCAL model for the same reason: it is the fallback,
                // and overwriting it with a cloud id leaves nothing valid to fall back to.
                const newSettings = {
                  ...settings,
                  ...(useCustom ? {} : { chatModel: model }),
                  useCustomLLM: useCustom,
                  // The switch must be SYMMETRIC. A cloud pick sets enabled: true; a local
                  // pick must set it back to false, because the router treats a still-
                  // enabled cloud config as 'use cloud' regardless of useCustomLLM. Without
                  // this, once any cloud model was ever picked, choosing Qwen in the header
                  // changed the label and nothing else — opus kept answering.
                  ...(settings.customLLM ? {
                    customLLM: useCustom
                      ? resetCliOnlyFields({
                          ...settings.customLLM,
                          model,
                          provider: (provider as typeof settings.customLLM.provider) || settings.customLLM.provider,
                          enabled: true,
                        }, (provider as typeof settings.customLLM.provider) || settings.customLLM.provider)
                      : { ...settings.customLLM, enabled: false }
                  } : {}),
                };
                if (!await saveModelSettings(newSettings)) return;
                setMessages(prev => [...prev, {
                  id: newId(), role: 'system',
                  content: `Switched to ${useCustom ? `☁️ ${model}` : `🦙 ${model}`}`,
                  createdAt: Date.now(), error: null
                }]);
              }}
              onConfigureCustom={() => setSettingsOpen(true)}
              locked={uncensoredMode}
              lockedModelId={settings.uncensoredModel || 'dolphin-mistral:7b'}
              lockReason="Turn off 🔓 Uncensored Mode to switch models"
              vramGB={vramGB}
            />
          </div>
          <div className="widget-titlebar-controls">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >&#x2699;</button>
            <button
              type="button"
              onClick={() => window.electron?.minimizeWindow?.()}
              title="Minimize"
              aria-label="Minimize"
            >&#x2013;</button>
            <button
              type="button"
              className="expand-btn"
              onClick={handleToggleWidgetMode}
              title="Expand to full window"
              aria-label="Expand"
            >&#x26F6;</button>
            <button
              type="button"
              className="close-btn"
              onClick={() => window.electron?.closeWindow?.()}
              title="Close"
              aria-label="Close"
            >&#x2715;</button>
          </div>
        </div>
      )}

      {widgetMode && (
        <div className="widget-first-task">
          <button type="button" onClick={async () => {
            try {
              const compact = await window.electron?.toggleWidgetMode?.();
              if (compact !== false) throw new Error('Could not expand HomeBot. Try the Expand button.');
              setWidgetMode(false);
              setMode('dashboard');
            } catch (error) {
              addToast(error instanceof Error ? error.message : 'Could not expand HomeBot. Please try again.', 'error');
            }
          }}>Explore HomeBot</button>
          <span>Find a place to start.</span>
        </div>
      )}

      {/* Expanded mode: custom titlebar with collapse button */}
      {!widgetMode && (
        <div className="widget-titlebar expanded-titlebar">
          <div className="widget-titlebar-brand">
            <Logo className="header-logo" size={22} />
            <span className={`widget-status-dot${status.ollama === 'offline' ? ' disconnected' : ''}`} />
            <h1>HomeBot</h1>
          </div>
          <div className="widget-titlebar-controls">
            <button
              type="button"
              className="expand-btn"
              onClick={handleToggleWidgetMode}
              title="Collapse to widget"
              aria-label="Collapse to widget"
            >&#x25A3;</button>
            <button
              type="button"
              onClick={() => window.electron?.minimizeWindow?.()}
              title="Minimize"
              aria-label="Minimize"
            >&#x2013;</button>
            <button
              type="button"
              onClick={() => window.electron?.maximizeWindow?.()}
              title="Maximize"
              aria-label="Maximize"
            >&#x25A1;</button>
            <button
              type="button"
              className="close-btn"
              onClick={() => window.electron?.closeWindow?.()}
              title="Close"
              aria-label="Close"
            >&#x2715;</button>
          </div>
        </div>
      )}

      {/* Conversation Sidebar */}
      <ErrorBoundary zone="Sidebar">
        <Suspense fallback={null}>
          <ConversationSidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            currentConversationId={conversationId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
          />
        </Suspense>
      </ErrorBoundary>

      {/* Status Indicator / Header */}
      {/* Update notice — mounted above the header so it never covers chat. */}
      <UpdateBanner />

      <StatusIndicator 
        connectionStatus={status} 
        onRefresh={async () => { try { const c = await window.electron.checkConnection?.(); if (c) { setStatus(c); if (c.n8n === 'online') setBackendDiagnostic(null); } } catch (e) { /* ignore */ } }} 
        onSettingsClick={() => setSettingsOpen(true)}
        onToolsClick={() => setToolsOpen(true)}
        onRagClick={() => setRagPanelOpen(true)}
        onTerminalClick={() => setTerminalOpen(true)}
        onWorkspaceClick={() => setWorkspaceOpen(true)}
        onAnalyticsClick={() => setAnalyticsOpen(true)}
        onNotificationsClick={() => setNotifHistoryOpen(true)}
        notificationCount={notifHistory.length}
        onMenuClick={() => setSidebarOpen(true)}
        onExportChat={async () => {
          const lines: string[] = [`# HomeBot Chat Export\n_Exported: ${new Date().toLocaleString()}_\n`];
          for (const m of messages) {
            if (m.role === 'system') continue;
            const label = m.role === 'user' ? '**You**' : '**HomeBot**';
            const ts = new Date(m.createdAt).toLocaleTimeString();
            lines.push(`### ${label} — ${ts}\n${m.content}\n`);
          }
          const markdown = lines.join('\n---\n\n');
          const result = await window.electron.exportChat?.(markdown);
          setMessages(prev => [...prev, {
            id: newId(), role: 'system',
            content: result?.success ? `Chat exported to Desktop: ${result.path?.split(/[\\/]/).pop()}` : `Export failed: ${result?.error}`,
            createdAt: Date.now(), error: null
          }]);
        }}
        backendDiagnostic={backendDiagnostic}
        onCopyDiagnostic={async (text: string) => {
          const ok = await copyTextToClipboard(text);
          setMessages(prev => [...prev, { id: newId(), role: 'system', content: ok ? 'Diagnostic copied to clipboard' : 'Could not copy diagnostic to the clipboard', createdAt: Date.now(), error: null }]);
        }}
        onDismissDiagnostic={() => setBackendDiagnostic(null)}
        mode={mode}
        onModeChange={setMode}
        moduleModes={moduleViews}
        currentModel={activeModel.model || settings.chatModel || 'qwen2.5:7b'}
        customLLM={settings.customLLM}
        useCustomLLM={settings.useCustomLLM}
        providerApiKeys={settings.providerApiKeys}
        uncensoredModel={settings.uncensoredModel || 'dolphin-mistral:7b'}
        vramGB={vramGB}
        onModelChange={async (model: string, useCustom: boolean, provider?: string) => {
          // Cloud picks must carry their provider. Saving only the id left configs
          // like { provider: 'google-ai-studio', model: 'opus' } — Gemini's endpoint
          // asked for a Claude model, which fails and silently drops to local.
          // chatModel stays a LOCAL model for the same reason: it is the fallback,
          // and overwriting it with a cloud id leaves nothing valid to fall back to.
          const newSettings = {
            ...settings,
            ...(useCustom ? {} : { chatModel: model }),
            useCustomLLM: useCustom,
            // The switch must be SYMMETRIC. A cloud pick sets enabled: true; a local
            // pick must set it back to false, because the router treats a still-
            // enabled cloud config as 'use cloud' regardless of useCustomLLM. Without
            // this, once any cloud model was ever picked, choosing Qwen in the header
            // changed the label and nothing else — opus kept answering.
            ...(settings.customLLM ? {
              customLLM: useCustom
                ? resetCliOnlyFields({
                    ...settings.customLLM,
                    model,
                    provider: (provider as typeof settings.customLLM.provider) || settings.customLLM.provider,
                    enabled: true,
                  }, (provider as typeof settings.customLLM.provider) || settings.customLLM.provider)
                : { ...settings.customLLM, enabled: false }
            } : {}),
          };
          if (!await saveModelSettings(newSettings)) return;
          setMessages(prev => [...prev, {
            id: newId(),
            role: 'system',
            content: `Switched to ${useCustom ? `☁️ ${model}` : `🦙 ${model}`}`,
            createdAt: Date.now(),
            error: null
          }]);
        }}
      />

      {/* Token counter — shown in chat mode */}
      {mode === 'chat' && (
        <div className="token-counter-bar">
          <Suspense fallback={null}>
            <TokenCounter messages={messages} model={settings.chatModel || 'qwen2.5:7b'} />
          </Suspense>
        </div>
      )}

          {unsavedReplyIds.map(id => {
            const reply = streamRepliesRef.current.get(id);
            if (!reply) return null;
            return <div role="alert" className="unsaved-reply-notice" key={id}>
              <p>This reply could not be saved. Copy it before leaving this chat or closing HomeBot.</p>
              {reply.conversationId !== conversationId && <button type="button" onClick={() => void handleSelectConversation(reply.conversationId)}>Open chat with unsaved reply</button>}
              <button type="button" onClick={async () => {
                const copied = await copyTextToClipboard(reply.message.content);
                addToast(copied ? 'Unsaved reply copied.' : 'Could not copy this reply. Open its chat to select and copy the text.', copied ? 'info' : 'error');
              }}>Copy unsaved reply</button>
              <button type="button" onClick={() => void reply.save(true)}>Retry saving reply</button>
            </div>;
          })}

      {/* Main Content Area */}
      {mode === 'dashboard' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <DashboardPanel
            onModeChange={setMode}
            onOpenSettings={() => setSettingsOpen(true)}
            onStartChat={() => {
              setMode('chat');
              requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.chat-interface textarea[aria-label="Message HomeBot"]')?.focus());
            }}
            onNewConversation={handleNewConversation}
          />
        </Suspense>
      ) : mode === 'chat' ? (
        <ErrorBoundary zone="Chat">
          {currentHeldSubmission && (
            <div role="status">
              <p>An earlier request was held without being sent. Clear or send your current draft to restore it.</p>
              <button type="button" onClick={() => restoreHeldSubmission(currentHeldSubmission)} disabled={!!composerDraft.text || !!composerDraft.images.length || !!composerDraft.documents.length}>Restore held request</button>
            </div>
          )}
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            onUserCancel={handleUserCancel}
            onRetry={retryMessage}
            onOpenSettings={() => setSettingsOpen(true)}
            draft={composerDraft}
            onDraftChange={next => { composerDraftRef.current = next; setComposerDraft(next); }}
            draftKey={conversationId || 'new'}
            draftGeneration={activeDraftGeneration}
            pendingAttachmentReads={pendingAttachmentReadsRef.current.get(activeDraftGeneration) || 0}
            onAttachmentsReady={handleAttachmentsReady}
            onAttachmentReadStart={handleAttachmentReadStart}
            onAttachmentReadEnd={handleAttachmentReadEnd}
            onAttachmentReadError={message => addToast(message, 'warning', 10000)}
            onBookmark={handleBookmark}
            onReact={handleReact}
            onEdit={handleEdit}
            onSendToMediaStudio={studioAvailable ? handleSendToMediaStudio : undefined}
            systemPrompt={conversationSystemPrompt}
            onUpdateSystemPrompt={updateConversationSystemPrompt}
          />
        </ErrorBoundary>
      ) : mode === 'automation' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <AutomationCenter navContext={navContext} />
        </Suspense>
      ) : mode === 'image' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ImageGenerator />
        </Suspense>
      ) : mode === 'documents' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <DocumentViewer onSendToChat={(filePath, content) => {
            try {
              const fileName = filePath.split(/[\\/]/).pop() || 'document';
              const ext = fileName.split('.').pop()?.toLowerCase() || 'txt';
              const mimeMap: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', json: 'application/json', md: 'text/markdown' };
              const bytes = new TextEncoder().encode(content);
              const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
              const doc: DocumentAttachment = {
                id: `doc-${Date.now()}`,
                filename: fileName,
                mimeType: mimeMap[ext] || 'text/plain',
                size: bytes.length,
                data: btoa(binary),
              };
              setMode('chat');
              setTimeout(() => {
                handleSendMessage(`I've attached "${fileName}". Please review this document.`, undefined, [doc]);
              }, 100);
            } catch (err) {
              console.error('[DocViewer] Failed to send to chat:', err);
            }
          }} />
        </Suspense>
      ) : ActiveModuleView ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ActiveModuleView navContext={navContext} />
        </Suspense>
      ) : mode === 'modules' || isBundledModuleMode(mode) ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ModulesPanel state={moduleState} onOpen={setMode} />
        </Suspense>
      ) : mode === 'code' ? (
        // WorkspaceShell is the VS Code–shaped IDE: Explorer, tabbed editor,
        // docked terminal, and browser panel. It was reachable only by opening
        // the Workspace overlay and finding an icon in its activity bar — two
        // levels deep, with nothing on the main screen suggesting it existed.
        // The Code mode makes it a first-class destination the assistant can
        // navigate to directly, carrying context (e.g. "help me with this repo"
        // opens the workspace pointed at the project root).
        //
        // It is rendered once, below, shared with the header Workspace button
        // and kept mounted so leaving Code mode does not discard unsaved edits.
        // It portals over the whole window, so this branch renders nothing.
        null
      ) : mode === 'browser' ? (
        // The same panel the Workspace uses. It was reachable only by opening
        // the Workspace and finding an icon in its activity bar — two levels
        // deep, with nothing on the main screen suggesting a browser existed.
        // Closing it returns to chat rather than leaving a blank mode.
        // Wrapped: .browser-panel is styled for the Workspace GRID (grid-row: 1,
        // width clamped to ~34vw), so dropped into a mode it renders as a narrow
        // column in the corner. The wrapper gives it a full-size context.
        <div className="browser-mode">
          <Suspense fallback={<div className="mode-loading">Loading...</div>}>
            <BrowserPanel onClose={() => setMode('chat')} />
          </Suspense>
        </div>
      ) : mode === 'feeds' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <FeedsPanel navContext={navContext} />
        </Suspense>
      ) : mode === 'connections' ? (
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <ConnectionsPanel navContext={navContext} />
        </Suspense>
      ) : (
        // Quiz is the final branch now. The Web Services panel used to be the
        // catch-all `else`, which meant any unrecognised mode silently rendered
        // it; quiz being terminal keeps the chain total without that surprise.
        <Suspense fallback={<div className="mode-loading">Loading...</div>}>
          <QuizPanel />
        </Suspense>
      )}

      {/* Action Confirmation Modal */}
      {awaitingConfirmation && pendingConfirmationData && (
        <ActionConfirmation
          actionSummary={pendingConfirmationData.message || 'Confirm this action?'}
          warnings={pendingConfirmationData.warnings || []}
          onConfirm={handleConfirmAction}
          onReject={handleRejectAction}
        />
      )}

      {pendingModelSuggestion && (
        <ActionConfirmation
          title="Suggest Better Model"
          message="HomeBot found a stronger local model for this one request."
          actionSummary={`Use ${pendingModelSuggestion.recommendation.recommendedModel} instead of ${pendingModelSuggestion.recommendation.currentModel} for this ${pendingModelSuggestion.recommendation.task} request?`}
          warnings={[pendingModelSuggestion.recommendation.reason]}
          confirmLabel="Use suggested model"
          rejectLabel="Keep current model"
          onConfirm={handleConfirmModelSuggestion}
          onReject={handleRejectModelSuggestion}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <ErrorBoundary zone="Settings">
          <Suspense fallback={null}>
            <SettingsPanel
              settings={settings}
              onSave={saveSettings}
              onClose={() => setSettingsOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Tools Panel */}
      {toolsOpen && <Suspense fallback={null}><ToolsPanel onClose={() => setToolsOpen(false)} /></Suspense>}

      {/* RAG Index Panel */}
      <Suspense fallback={null}>
        <RagPanel isOpen={ragPanelOpen} onClose={() => setRagPanelOpen(false)} />
      </Suspense>

      {/* Workspace — VS Code-shaped IDE: Explorer, tabbed editor, docked terminal */}
      {workspaceMounted && (
        <Suspense fallback={workspaceVisible ? <div className="mode-loading">Loading...</div> : null}>
                    {/* One shell for both entry points: the mode bar's Code button and
              the header Workspace button. Carrying navContext keeps the two
              consistent: a handoff that rooted the shell on a repo
              ("help me with this repo") must survive the header-open path too.
              Dropping navContext here makes Code mode reach the same
              dead-end-on-second-handoff class the bootstrap effect guards.
              `open` only hides it; staying mounted is what preserves edits. */ }
          <WorkspaceShell
            open={workspaceVisible}
            onClose={leaveWorkspaceToChat}
            onHome={leaveWorkspaceHome}
            onBack={leaveWorkspaceBack}
            navContext={navContext}
          />
        </Suspense>
      )}

      {/* Terminal — runs in the configured project folder, sandboxed to home */}
      {terminalOpen && (
        <Suspense fallback={null}>
          {/* onSendToChat is intentionally not wired yet: the chat input lives
              inside InputBox/ChatInterface, not App, so routing an excerpt into
              it needs a small lift of that state. The button hides itself until
              then rather than pretending to work. */}
          <TerminalPanel
            open={terminalOpen}
            onClose={() => setTerminalOpen(false)}
            projectPath={settings?.projectPath}
          />
        </Suspense>
      )}

      {/* Analytics Dashboard */}
      {analyticsOpen && (
        <Suspense fallback={null}>
          <TelemetryDashboard open={analyticsOpen} onClose={() => setAnalyticsOpen(false)} />
        </Suspense>
      )}

      {/* Permission Modal (appears when main requests permission escalation) */}
      <PermissionModal open={permissionModalOpen} missingPermissions={permissionRequestData?.missingPermissions || []} reason={permissionRequestData?.reason} requestId={permissionRequestData?.requestId} timeoutMs={permissionRequestData?.timeoutMs} onClose={() => { setPermissionModalOpen(false); setPermissionRequestData(null); }} />

      {/* Keyboard Shortcuts Panel */}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}

      {/* Notification History */}
      {notifHistoryOpen && (
        <Suspense fallback={null}>
          <NotificationHistory open={notifHistoryOpen} onClose={() => setNotifHistoryOpen(false)} history={notifHistory} onClear={clearNotifHistory} />
        </Suspense>
      )}

      {/* Voice Conversation + Screen Capture floating buttons */}
      <div className="floating-feature-buttons">
        <button
          type="button"
          className="fab-btn fab-voice"
          onClick={() => setVoiceOpen(true)}
          title="Voice Conversation"
          aria-label="Voice conversation"
        >🎙</button>
        <button
          type="button"
          className="fab-btn fab-capture"
          onClick={async () => {
            try {
              const result = await window.electron.captureScreen?.();
              if (result?.success && result.dataUrl) {
                const img: import('../shared/types').ImageAttachment = {
                  filename: 'screenshot.png',
                  dataUrl: result.dataUrl,
                  url: result.dataUrl,
                  mimeType: 'image/png',
                };
                setMode('chat');
                handleSendMessage('What do you see on my screen? Describe and help with anything visible.', [img]);
              } else {
                addToast(result?.error || 'Screen capture failed', 'warning', 5000);
              }
            } catch (e: any) {
              addToast('Screen capture not available', 'warning', 5000);
            }
          }}
          title="Capture Screen"
          aria-label="Capture screen"
        >📸</button>
      </div>

      {/* Voice Conversation Panel */}
      <Suspense fallback={null}>
        <VoiceConversation
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSendMessage={(text: string) => {
            setMode('chat');
            handleSendMessage(text);
          }}
          lastAssistantMessage={
            messages.filter(m => m.role === 'assistant' && m.streamingState === 'finished').slice(-1)[0]?.content
          }
        />
      </Suspense>

      {firstRunOpen && (
        <Suspense fallback={<div className="first-run-overlay"><div className="first-run-modal first-run-loading">Loading...</div></div>}>
          <FirstRunModal
            open={firstRunOpen}
            settings={settings as any}
            onSave={async (s) => {
              await saveSettings(s as any);
              const enabled = !!s.uncensoredMode;
              try {
                const applied = await window.electron.setUncensoredMode?.(enabled);
                if (!applied?.success || applied.enabled !== enabled) throw new Error('Mode acknowledgement missing');
              } catch {
                throw new Error('Your choices were saved, but HomeBot could not apply the model mode. Try Finish setup again.');
              }
              window.dispatchEvent(new CustomEvent('homebot:uncensored-mode-changed', { detail: enabled }));
            }}
            onClose={() => setFirstRunOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
