/**
 * All of the Settings panel's state, in one place.
 *
 * SettingsPanel.tsx was 2,725 lines because the state and every control lived
 * in the same function. Splitting the controls into tabs needs the state to
 * outlive any one tab, so it moves here and the tabs read it from
 * SettingsContext. Nothing about WHAT is stored or HOW it is saved changed —
 * this is the same code, relocated.
 *
 * The tabs get their types from `ReturnType<typeof useSettingsState>`, so there
 * is no hand-maintained interface to drift out of step with what is returned.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useConfirmDestructive } from '../ConfirmDestructive';
import type { Settings as SharedSettings, CustomLLMConfig, CustomModelInfo, ScheduledJob, PerfStatSummary } from '../../../shared/types';
import type { LicenseStatus, UpgradePrompt } from '../../../shared/types';
import { buildSupportReport } from '../../../shared/support-report';
import { isGateBlocked } from '../../../shared/upgrade';
import { apiKeyForProvider } from '../../../shared/cloud-llm';

export interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  n8nApiKey?: string;
  widgetHotkey: string;
  globalHotkey?: string;
  modelRoutingMode?: 'off' | 'prompt' | 'auto';
  chatModel?: string;
  uncensoredModel?: string;
  visionModel?: string;
  uncensoredMode?: boolean;
  telemetryEnabled?: boolean;
  permissions?: Record<string, boolean>;
  telemetryConsentTimestamp?: string;
  telemetryConsentVersion?: string;
  customLLM?: CustomLLMConfig;
  useCustomLLM?: boolean;
  searxngUrl?: string;
  tavilyApiKey?: string;
  serperApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  moonshotApiKey?: string;
  /** One key per cloud provider — see shared/types.ts. */
  providerApiKeys?: Record<string, string>;
  stableHordeApiKey?: string;
  codeModel?: string;
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'google-gemini' | 'huggingface' | 'cerebras' | 'sambanova' | 'together' | 'custom';
  codeApiUrl?: string;
  chatGuidelines?: string;
  calendarIcsUrl?: string;
  voiceEngine?: 'whisper' | 'sapi' | 'webspeech';
  whisperModel?: 'tiny' | 'base' | 'small';
  voiceLanguage?: string;
  voiceSilenceStopSec?: number;
  voiceMicDeviceId?: string;
  notificationsEnabled?: boolean;
  notificationSound?: boolean;
  notificationDuration?: number;
  permissionPromptTimeoutMs?: number;
  messageDensity?: 'compact' | 'comfortable' | 'spacious';
  moaEnabled?: boolean;
  moaProposers?: string[];
  moaAggregator?: string;
  hardwareProfile?: '4gb' | '8gb' | '16gb+';
  defaultLocation?: string;
  /**
   * Offer a morning briefing on the first message each day. Read by
   * morning-briefing.ts as `=== false`, so undefined means ON.
   */
  morningBriefing?: boolean;
  /** The Media Studio publishing kill switch — see media-studio.ts. */
  mediaPublishingEnabled?: boolean;
  /** Allow a rendering proxy as the last fetch fallback — see shared/types.ts. */
  webReaderFallbackEnabled?: boolean;
  /** Background music for generated video — see shared/types.ts. */
  mediaMusicEnabled?: boolean;
  mediaMusicFolder?: string;
  /** Cloud chat temperature override (0–2); unset = provider default. */
  chatTemperature?: number;
  /** Whether chats are written to disk — see shared/types.ts. */
  saveConversationHistory?: boolean;
}

export interface UseSettingsStateArgs {
  settings: SharedSettings;
  onSave: (settings: SharedSettings) => void;
  onClose: () => void;
}

export function useSettingsState({ settings, onSave, onClose }: UseSettingsStateArgs) {
  const defaultModels = {
    chatModel: 'qwen2.5:7b',
    uncensoredModel: 'dolphin-mistral:7b',
    visionModel: 'moondream',
    codeModel: 'qwen2.5-coder:7b'
  };

  const defaultCustomLLM: CustomLLMConfig = {
    name: 'Custom LLM',
    apiUrl: '',
    apiKey: '',
    provider: 'openai',
    model: '',
    enabled: false
  };

  // Get the canonical API URL for known providers
  const getDefaultApiUrl = (provider: string) => {
    switch (provider) {
      case 'openai': return 'https://api.openai.com/v1';
      case 'anthropic': return 'https://api.anthropic.com/v1';
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      case 'groq': return 'https://api.groq.com/openai/v1';
      case 'deepseek': return 'https://api.deepseek.com/v1';
      case 'google-ai-studio': return 'https://generativelanguage.googleapis.com/v1beta/openai';
      case 'google-gemini': return 'https://generativelanguage.googleapis.com/v1beta';
      case 'huggingface': return 'https://api-inference.huggingface.co/v1';
      case 'cerebras': return 'https://api.cerebras.ai/v1';
      case 'sambanova': return 'https://api.sambanova.ai/v1';
      case 'together': return 'https://api.together.xyz/v1';
      default: return '';
    }
  };

  const buildLocalSettings = (source: SharedSettings): Settings => {
    const llm = source.customLLM ? { ...defaultCustomLLM, ...source.customLLM } : { ...defaultCustomLLM };
    // Fill canonical URL only if the user hasn't set a custom one
    const providerDefault = getDefaultApiUrl(llm.provider);
    if (providerDefault && !llm.apiUrl) llm.apiUrl = providerDefault;
    // Auto-fill this provider's saved key if the config doesn't carry one.
    //
    // This used to be a four-branch if/else naming anthropic, openai, gemini
    // and moonshot — the only providers with a top-level field — which is why
    // a groq or cerebras key had nowhere to come back from. apiKeyForProvider
    // is the same lookup the router uses, so the panel and the router cannot
    // disagree about whether a provider is configured.
    if (!llm.apiKey) {
      llm.apiKey = apiKeyForProvider(source as any, llm.provider);
    }
    return {
      ...source,
      modelRoutingMode: source.modelRoutingMode || 'prompt',
      chatModel: source.chatModel || defaultModels.chatModel,
      uncensoredModel: source.uncensoredModel || defaultModels.uncensoredModel,
      visionModel: source.visionModel || defaultModels.visionModel,
      codeModel: source.codeModel ?? '',
      useCustomLLM: source.useCustomLLM ?? false,
      customLLM: llm,
      searxngUrl: source.searxngUrl || '',
      tavilyApiKey: source.tavilyApiKey || '',
      serperApiKey: source.serperApiKey || '',
      anthropicApiKey: source.anthropicApiKey || '',
      openaiApiKey: source.openaiApiKey || '',
      geminiApiKey: source.geminiApiKey || '',
      moonshotApiKey: source.moonshotApiKey || '',
      stableHordeApiKey: source.stableHordeApiKey || '',
      codeApiKey: source.codeApiKey || '',
      codeApiProvider: source.codeApiProvider || 'openai',
      codeApiUrl: source.codeApiUrl || '',
      chatGuidelines: source.chatGuidelines || '',
      calendarIcsUrl: source.calendarIcsUrl || '',
      notificationsEnabled: source.notificationsEnabled !== false,
      notificationSound: !!source.notificationSound,
      notificationDuration: source.notificationDuration ?? 8000,
      messageDensity: source.messageDensity || 'comfortable',
      moaEnabled: source.moaEnabled ?? false,
      moaProposers: source.moaProposers ?? [],
      moaAggregator: source.moaAggregator ?? '',
      defaultLocation: source.defaultLocation || '',
      permissionPromptTimeoutMs: source.permissionPromptTimeoutMs ?? 60000
    };
  };

  // Models ordered by quality for modest local GPUs. Users can still choose any installed model.
  const ollamaModels = [
    {
      id: 'gemma4:e4b',
      name: 'Gemma 4 (E4B)',
      description: 'Most capable local model; strong general chat (9.6GB)',
      sizeGB: 9.6,
      recommendedFor: ['16gb+']
    },
    {
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 (7B)',
      description: 'Best tool-calling and reasoning; HomeBot default (4.7GB)',
      sizeGB: 4.7,
      recommendedFor: ['4gb', '8gb', '16gb+']
    },
    {
      id: 'qwen2.5-coder:7b',
      name: 'Qwen 2.5 Coder (7B)',
      description: 'Best local coding quality (4.4GB)',
      sizeGB: 4.4,
      recommendedFor: ['8gb', '16gb+']
    },
    {
      id: 'moondream',
      name: 'Moondream 2 (Vision)',
      description: 'Lightweight vision model for image description (1.7GB)',
      sizeGB: 1.7,
      recommendedFor: ['4gb', '8gb', '16gb+']
    },
  ];

  const [confirmDialog, confirmDestructive] = useConfirmDestructive();

  const [localSettings, setLocalSettings] = useState<Settings>(buildLocalSettings(settings));
  const [uncensoredMode, setUncensoredMode] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, boolean>>(((settings as any).permissions || {}) as Record<string, boolean>);
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [availableModels, setAvailableModels] = useState<CustomModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [_modelsFetchedAt, setModelsFetchedAt] = useState<number | null>(null);
  const [installedOllamaModels, setInstalledOllamaModels] = useState<Array<{ name: string; size: number }>>([]);

  // Collapsible sections — General and Models open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    general: true,
    models: true,
    voice: true,
    cloud: true,
    api_keys: true,
    appearance: true,
    n8n: true,
    permissions: true,
    advanced: true,
    diagnostics: false,
    license: true,
  });
  const toggleSection = (id: string) => setOpenSections(s => ({ ...s, [id]: !s[id] }));

  // Diagnostics & Performance: baseline startup + first-token (TTFT) aggregates
  const [perfStats, setPerfStats] = useState<{ startup: PerfStatSummary; firstToken: PerfStatSummary } | null>(null);
  const [perfHistory, setPerfHistory] = useState<{ startup: number[]; firstToken: number[] } | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const loadPerfStats = async () => {
    setPerfLoading(true);
    try {
      const [r, h] = await Promise.all([
        window.electron?.getPerfAggregates?.(),
        window.electron?.getPerfHistory?.(20),
      ]);
      if (r) setPerfStats(r);
      if (h) setPerfHistory(h);
    } catch { /* ignore — empty-state will render */ }
    finally { setPerfLoading(false); }
  };
  useEffect(() => {
    if (openSections.diagnostics && !perfStats && !perfLoading) { void loadPerfStats(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSections.diagnostics]);

  // System check: on-demand re-run of the first-run environment diagnostics
  // (disk / Ollama / n8n / Qdrant / write-permissions / GPU). Reuses the
  // existing `homebot:run-diagnostics` IPC — renderer-only, no main changes.
  type SysCheckReport = {
    disk: { freeGB: number | null; ok: boolean; warning: string | null };
    ollama: { reachable: boolean; latencyMs: number | null };
    n8n: { reachable: boolean; latencyMs: number | null };
    qdrant: { reachable: boolean; latencyMs: number | null };
    permissions: { canWrite: boolean };
    hardware: { vramGB: number | null; gpuName: string | null; profile: string | null };
    timestamp: string;
  };
  // n8n connection test (Settings → n8n API key)
  const [n8nTesting, setN8nTesting] = useState(false);
  const [n8nTestResult, setN8nTestResult] = useState<string | null>(null);

  // Voice: available microphone input devices (labels require mic permission)
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const refreshMicDevices = async () => {
    try {
      // A short-lived stream unlocks device labels in enumerateDevices()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
    } catch { /* permission denied — labels stay generic */ }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(devices.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label })));
    } catch { /* enumeration unsupported */ }
  };
  useEffect(() => {
    // Populate on open without forcing a permission prompt
    navigator.mediaDevices?.enumerateDevices?.()
      .then(devices => setMicDevices(devices.filter(d => d.kind === 'audioinput').map(d => ({ deviceId: d.deviceId, label: d.label }))))
      .catch(() => { /* unsupported */ });
  }, []);

  const [sysCheck, setSysCheck] = useState<SysCheckReport | null>(null);
  const [sysCheckLoading, setSysCheckLoading] = useState(false);
  const [sysCheckError, setSysCheckError] = useState<string | null>(null);
  const runSystemCheck = async () => {
    setSysCheckLoading(true);
    setSysCheckError(null);
    try {
      const r = await (window as any).electron?.runDiagnostics?.();
      if (r) setSysCheck(r as SysCheckReport);
      else setSysCheckError('System check is unavailable on this build.');
    } catch (e: any) {
      setSysCheckError(e?.message || 'System check failed.');
    } finally {
      setSysCheckLoading(false);
    }
  };

  // Copy a combined diagnostics "support report" (perf + system check + env)
  // to the clipboard so users can paste a full snapshot when reporting issues.
  const [reportCopied, setReportCopied] = useState(false);
  const copySupportReport = async () => {
    const report = buildSupportReport({
      generatedAt: new Date().toISOString(),
      platform: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      perf: perfStats,
      systemCheck: sysCheck,
    });
    try {
      await navigator.clipboard.writeText(report);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch {
      /* clipboard unavailable — non-critical */
    }
  };

  // Fetch installed Ollama models on mount
  useEffect(() => {
    window.electron?.listOllamaModels?.().then(res => {
      if (res?.success && res.models) setInstalledOllamaModels(res.models);
    }).catch(() => {});
  }, []);

  /**
   * Remove a downloaded model.
   *
   * `deleteOllamaModel` has been on the preload bridge, wired to a working main
   * handler, with ZERO callers — while pulling a model is offered in three
   * places. So one click could take 9.6 GB and nothing in HomeBot would ever
   * give it back. That matters beyond tidiness: model-download-fit refuses
   * pulls that will not fit, so the app could talk itself into a corner it
   * offered no way out of.
   */
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelDeleteError, setModelDeleteError] = useState<string | null>(null);

  const deleteInstalledModel = async (modelName: string) => {
    setDeletingModel(modelName);
    setModelDeleteError(null);
    try {
      const res = await window.electron?.deleteOllamaModel?.(modelName);
      if (res?.success) {
        // Drop it locally rather than re-listing: Ollama has already removed
        // it, and a refetch would only be a slower way to learn the same thing.
        setInstalledOllamaModels(prev => prev.filter(m => m.name !== modelName));
      } else {
        setModelDeleteError(res?.error || `Could not delete ${modelName}.`);
      }
    } catch (e: any) {
      setModelDeleteError(e?.message || `Could not delete ${modelName}.`);
    } finally {
      setDeletingModel(null);
    }
  };

  const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    // Filesystem
    read_file: 'Read the contents of a file (safe, read-only).',
    list_directory: 'List files and folders within a directory (safe).',
    create_directory: 'Create a new folder in your home directory.',
    get_file_info: 'Get file details like size, type, and dates (safe).',
    copy_file: 'Copy files and folders to a new location.',
    search_files: 'Search inside file contents for matching text (safe).',
    find_files: 'Find files by name using system search (safe).',
    parse_document_from_path: 'Parse PDF, Word, or text files (read-only).',
    write_file: 'Create or overwrite files. Could modify important data.',
    edit_file: 'Make targeted edits to existing files.',
    delete_file: 'Permanently delete files or folders. Irreversible.',
    move_file: 'Move or rename files. May overwrite existing files.',
    create_docx: 'Create Word documents on your Desktop.',
    create_spreadsheet: 'Create Excel spreadsheets on your Desktop.',
    create_pdf: 'Create PDF documents on your Desktop.',
    // System
    get_system_info: 'Read system info like OS, CPU, and memory (safe).',
    get_current_time: 'Get the current date and time (safe).',
    calculate: 'Perform math calculations (safe).',
    open_url: 'Open a URL in your default browser.',
    open_in_browser: 'Open a link in your default browser.',
    browser_search: 'Search in your default browser.',
    show_notification: 'Show desktop notifications.',
    launch_app: 'Launch applications on your system (e.g. Notepad, Chrome).',
    screenshot: 'Take a screenshot of your display.',
    // Web & search
    web_search: 'Search the web and fetch results from multiple sources.',
    fetch_url: 'Fetch content from a specific URL.',
    fetch_page_content: 'Download and extract text from a web page.',
    nba_query: 'Query live NBA scores and stats from ESPN.',
    get_news: 'Fetch news articles from configured RSS feeds.',
    list_news_feeds: 'List available news feed sources (safe).',
    get_weather: 'Get current weather and forecast for a location.',
    image_generate: 'Generate images using AI (Stable Horde or DALL-E).',
    // Documents
    parse_document: 'Parse uploaded documents (PDF, Word, text).',
    get_document_content: 'Read parsed document content (safe).',
    list_documents: 'List previously parsed documents (safe).',
    search_document: 'Search within a parsed document (safe).',
    // Vision
    vision_describe: 'Describe an image using the vision model (safe).',
    vision_query: 'Answer questions about an image (safe).',
    look_at_browser: 'Read the page open in the browser panel (safe).',
    // Voice
    speak: 'Read text aloud using text-to-speech.',
    stop_speaking: 'Stop the current text-to-speech playback.',
    get_voices: 'List available text-to-speech voices (safe).',
    // Memory
    remember: 'Save information to long-term memory.',
    recall: 'Retrieve saved memories (safe).',
    list_memories: 'List all saved memories (safe).',
    forget: 'Delete a saved memory. Irreversible.',
    save_conversation: 'Save the current conversation to history.',
    get_conversation_history: 'Load past conversations (safe).',
    clear_conversation_history: 'Delete all conversation history. Irreversible.',
    // RAG
    rag_query: 'Search indexed documents semantically (safe).',
    rag_list: 'List documents in the RAG index (safe).',
    rag_index: 'Add a document to the semantic search index.',
    rag_clear: 'Remove a document from the RAG index.',
    // Diff
    diff_text: 'Compare two text strings and show differences (safe).',
    diff_files: 'Compare two files and show differences (safe).',
    // Reminders & calendar
    list_reminders: 'List active reminders (safe).',
    set_reminder: 'Create a new reminder.',
    cancel_reminder: 'Cancel an active reminder.',
    list_calendar_events: 'View upcoming calendar events (safe).',
    add_calendar_event: 'Add a new calendar event.',
    delete_calendar_event: 'Delete a calendar event.',
    // Clipboard
    clipboard_read: 'Read text from your clipboard (safe).',
    clipboard_write: 'Write text to your clipboard.',
    get_clipboard: 'Read clipboard contents (safe).',
    set_clipboard: 'Replace clipboard contents.',
    // Planning & contacts
    plan_task: 'Create a step-by-step plan for a task.',
    get_plans: 'View saved plans (safe).',
    search_contacts: 'Search your contacts list (safe).',
    add_contact: 'Add a new contact.',
    // Git
    git_status: 'View git repository status (safe).',
    git_log: 'View git commit history (safe).',
    git_diff: 'View file changes in git (safe).',
    git_branches: 'List git branches (safe).',
    media_create_job: 'Start a new video in the Media Studio (safe — nothing is published).',
    media_list_jobs: 'List videos and the stage each has reached (safe).',
    media_list_music: 'List music available for narration soundtracks (safe).',
    media_advance_job: 'Move a video to its next pipeline stage. Cannot approve or publish.',
    media_approve_job: 'Approve a finished video so it can be scheduled and published.',
    media_reject_job: 'Reject a video, or send it back for another revision.',
    git_commit: 'Create a git commit. Modifies your repository.',
    // Skills
    use_skill: 'Load a saved skill recipe into the conversation (safe).',
    list_skills: 'List installed skills (safe).',
    // CRM — reads safe; every write is also confirmation-gated in chat
    crm_search_companies: 'Search business CRM companies (safe).',
    crm_search_contacts: 'Search business CRM contacts (safe).',
    crm_search_deals: 'Search deals in the pipeline (safe).',
    crm_find_stale_deals: 'Find deals with no recent activity (safe).',
    crm_daily_brief: 'Summarise stale deals, tasks, and pipeline totals (safe).',
    crm_get_stages: 'List pipeline stages (safe).',
    crm_audit_log: 'Read the CRM change history (safe).',
    crm_create_company: 'Create a company record in the business CRM.',
    crm_update_company: 'Update an existing company record.',
    crm_create_contact: 'Create a person record in the business CRM.',
    crm_update_contact: 'Update an existing contact record.',
    crm_create_deal: 'Create a deal/opportunity in the pipeline.',
    crm_update_deal: 'Update an existing deal.',
    crm_advance_deal: 'Move a deal to another pipeline stage.',
    crm_log_activity: 'Log an email/call/meeting touchpoint against a record.',
    crm_add_note: 'Attach a note to a contact, company, or deal.',
    crm_create_task: 'Create a follow-up task.',
    crm_complete_task: 'Mark a task as completed.',
    crm_rename_stage: "Rename a pipeline stage's display label.",
    crm_match_email: 'Match an email sender to the CRM, creating records if needed.',
    crm_export: 'Export every CRM table to files on disk.',
    // Process management
    list_processes: 'List running processes (safe).',
    get_process_info: 'Get details about a running process (safe).',
    kill_process: 'Terminate a running process. Could cause data loss.',
    // Code & terminal
    run_code: 'Execute code snippets. Could modify your system.',
    run_terminal_command: 'Run shell commands. A confirmation dialog appears before execution.',
    get_terminal_history: 'View recent terminal command history (safe).',
    grep_code: 'Search file contents by regex across a project (safe).',
    project_tree: 'Show directory structure of a project (safe).',
    analyze_file: 'Get a quick overview of a source file (safe).',
    // Email
    email_send: 'Send an email on your behalf.',
    email_draft: 'Create an email draft.',
    email_list: 'List recent emails (safe).',
    // API
    api_request: 'Make HTTP requests to external APIs.',
  };

  const DANGEROUS_PERMISSIONS = new Set([
    'delete_file', 'move_file', 'write_file', 'edit_file', 'launch_app', 'screenshot',
    'kill_process', 'run_code', 'git_commit', 'forget', 'clear_conversation_history',
    'rag_clear', 'cancel_reminder', 'delete_calendar_event', 'email_send', 'api_request',
    'create_docx', 'create_spreadsheet', 'create_pdf', 'set_clipboard', 'clipboard_write',
    'crm_create_company', 'crm_update_company', 'crm_create_contact', 'crm_update_contact',
    'crm_create_deal', 'crm_update_deal', 'crm_advance_deal', 'crm_log_activity',
    'crm_add_note', 'crm_create_task', 'crm_complete_task', 'crm_rename_stage',
    'crm_match_email', 'crm_export',
  ]);

  const [telemetryLog, setTelemetryLog] = useState<string[]>([]);
  const [showTelemetryDashboard, setShowTelemetryDashboard] = useState(false);
  const [showPermissionHistory, setShowPermissionHistory] = useState(false);
  const [showTrustPanel, setShowTrustPanel] = useState(false);

  // GPU VRAM detection state for MoA recommendations
  const [gpuInfo, setGpuInfo] = useState<{
    vramGB: number | null;
    gpuName: string | null;
    recommendation: { mode: 'moa' | 'single'; preset?: string | null; model?: string | null; reason: string } | null;
    detecting: boolean;
    manualVram: number | null;
  }>({ vramGB: null, gpuName: null, recommendation: null, detecting: false, manualVram: null });

  const handleDetectGpu = async () => {
    setGpuInfo(prev => ({ ...prev, detecting: true }));
    try {
      const result = await window.electron.detectGpuVram?.();
      if (result?.success && result.vramGB) {
        setGpuInfo({
          vramGB: result.vramGB,
          gpuName: result.gpuName || null,
          recommendation: result.recommendation || null,
          detecting: false,
          manualVram: null,
        });
      } else {
        setGpuInfo(prev => ({ ...prev, detecting: false }));
      }
    } catch {
      setGpuInfo(prev => ({ ...prev, detecting: false }));
    }
  };

  const handleManualVram = (gb: number) => {
    // Client-side recommendation tuned for the current local model pack.
    type Rec = { mode: 'moa' | 'single'; preset?: string | null; model?: string | null; reason: string };
    let rec: Rec | null = null;
    if (gb >= 10) {
      rec = { mode: 'moa', preset: 'codeHeavy', reason: `Code-focused MoA fits your ${gb} GB VRAM` };
    } else if (gb >= 8) {
      rec = { mode: 'moa', preset: 'balanced', reason: `Balanced MoA fits your ${gb} GB VRAM` };
    } else if (gb >= 4) {
      rec = { mode: 'single', model: 'qwen2.5:7b', reason: `qwen2.5:7b is the best general model for ${gb} GB VRAM.` };
    } else if (gb >= 2) {
      rec = { mode: 'single', model: 'qwen2.5:7b', reason: `qwen2.5:7b may be tight on ${gb} GB but is the best available model.` };
    }
    setGpuInfo(prev => ({ ...prev, manualVram: gb, vramGB: gb, recommendation: rec }));
  };

  const profileVramGB = (profile?: Settings['hardwareProfile']): number | null => {
    if (profile === '4gb') return 4;
    if (profile === '8gb') return 8;
    if (profile === '16gb+') return 16;
    return null;
  };

  const effectiveVramGB = gpuInfo.vramGB ?? profileVramGB(localSettings.hardwareProfile);
  const effectiveProfile = localSettings.hardwareProfile || (
    effectiveVramGB === null ? undefined : effectiveVramGB >= 16 ? '16gb+' : effectiveVramGB >= 8 ? '8gb' : '4gb'
  );

  const getModelFit = (model: { id: string; sizeGB?: number; recommendedFor?: string[] }) => {
    if (effectiveProfile && model.recommendedFor?.includes(effectiveProfile)) return 'recommended';
    if (!effectiveVramGB || !model.sizeGB) return 'unknown';
    if (model.sizeGB > effectiveVramGB) return 'over';
    if (model.sizeGB > effectiveVramGB * 0.8) return 'tight';
    return 'ok';
  };

  const modelFitLabel = (fit: string) => {
    if (fit === 'recommended') return 'Recommended';
    if (fit === 'tight') return 'Tight fit';
    if (fit === 'over') return 'May be slow';
    return '';
  };

  const applyRecommendation = () => {
    if (!gpuInfo.recommendation) return;
    const rec = gpuInfo.recommendation;
    if (rec.mode === 'moa' && rec.preset) {
      const presetMap: Record<string, { proposers: string[]; aggregator: string }> = {
        balanced: { proposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], aggregator: 'gemma4:e4b' },
        codeHeavy: { proposers: ['qwen2.5-coder:7b', 'qwen2.5:7b'], aggregator: 'gemma4:e4b' },
        lightweight: { proposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], aggregator: 'qwen2.5:7b' },
      };
      const preset = presetMap[rec.preset];
      if (preset) {
        setLocalSettings({ ...localSettings, moaEnabled: true, moaProposers: preset.proposers, moaAggregator: preset.aggregator });
      }
    } else if (rec.mode === 'single') {
      // Disable MoA and set the recommended single model
      setLocalSettings({ ...localSettings, moaEnabled: false, chatModel: rec.model || 'qwen2.5:7b' });
    }
  };

  // Pro licensing state
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);

  const loadLicenseStatus = async () => {
    try {
      const status = await (window as any).electron?.licenseStatus?.();
      if (status) setLicenseStatus(status);
    } catch { /* IPC not yet ready */ }
  };
  useEffect(() => { loadLicenseStatus(); }, []);

  const handleActivateLicense = async () => {
    if (!licenseKeyInput.trim()) return;
    setLicenseBusy(true);
    setLicenseMessage(null);
    try {
      const result = await (window as any).electron?.licenseActivate?.(licenseKeyInput.trim());
      if (result?.valid) {
        setLicenseMessage('✓ Pro activated on this device.');
        setLicenseKeyInput('');
      } else {
        setLicenseMessage(result?.error || 'Activation failed — check the license key.');
      }
    } finally {
      setLicenseBusy(false);
      loadLicenseStatus();
    }
  };

  const handleDeactivateLicense = async () => {
    if (!confirm('Deactivate Pro on this device? You can reactivate later with the same key.')) return;
    setLicenseBusy(true);
    setLicenseMessage(null);
    try {
      await (window as any).electron?.licenseDeactivate?.();
      setLicenseMessage('License deactivated on this device.');
    } finally {
      setLicenseBusy(false);
      loadLicenseStatus();
    }
  };

  // Scheduler state
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobForm, setJobForm] = useState({
    name: '',
    message: '',
    mode: 'interval' as 'interval' | 'daily',
    intervalMinutes: 60,
    dailyTime: '09:00',
  });

  const loadJobs = async () => {
    try {
      const jobs = await (window as any).electron?.schedulerList?.();
      if (Array.isArray(jobs)) setScheduledJobs(jobs);
      else if (isGateBlocked(jobs)) setScheduledJobs([]);
    } catch { /* IPC not yet ready */ }
  };

  useEffect(() => { loadJobs(); }, []);

  // MCP server management state
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpStatus, setMcpStatus] = useState<any[]>([]);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpForm, setMcpForm] = useState({
    type: 'stdio' as 'stdio' | 'sse',
    name: '',
    command: '',
    args: '',
    env: '',
    url: '',
    enabled: true
  });

  const refreshTelemetryLog = async () => {
    try {
      const r = await (window as any).electron?.readConsentLog?.();
      let entries: string[] = [];
      if (r && r.success && typeof r.data === 'string') {
        const lines = r.data.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            entries.push(JSON.stringify(obj, null, 2));
          } catch (e) {
            entries.push(line);
          }
        }
      }
      setTelemetryLog(entries);
    } catch (e) {
      setTelemetryLog([`Failed to read consent log: ${String(e)}`]);
    }
  };

  const telemetryLogPreview = () => {
    if (!telemetryLog || telemetryLog.length === 0) return 'No consent log entries found.';
    return telemetryLog.join('\n\n-----\n\n');
  };

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(buildLocalSettings(settings));
    setPermissions((settings as any).permissions || {});
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
  }, [settings]);

  // Load uncensored mode state on mount
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
  }, []);

  useEffect(() => {
    panelRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Load MCP server list on mount
  const loadMcpServers = async () => {
    try {
      const servers = await (window as any).electron?.mcpListServers?.();
      const status = await (window as any).electron?.mcpGetStatus?.();
      if (servers) setMcpServers(servers);
      if (status) setMcpStatus(status);
    } catch (e) { /* silently ignore if IPC not yet ready */ }
  };

  useEffect(() => { loadMcpServers(); }, []);

  const handleUncensoredToggle = async (enabled: boolean) => {
    setUncensoredMode(enabled);
    await (window as any).electron?.setUncensoredMode?.(enabled);
    // Model switches immediately - no restart needed
  };

  const selectedProvider = localSettings.customLLM?.provider || 'openai';
  const curatedProviders = ['openai', 'anthropic', 'claude-code', 'codex', 'moonshot', 'groq', 'deepseek', 'google-ai-studio', 'google-gemini', 'huggingface', 'cerebras', 'sambanova', 'together'];
  const isCuratedProvider = curatedProviders.includes(selectedProvider);
  // Claude Code and Codex both run locally against the user's own subscription
  // (Claude Max / ChatGPT) — no key, no endpoint.
  const isClaudeCode = selectedProvider === 'claude-code';
  const isSubscriptionCli = isClaudeCode || selectedProvider === 'codex';
  const providerRequiresApiKey = selectedProvider !== 'custom' && !isSubscriptionCli;
  const hasApiKey = Boolean(localSettings.customLLM?.apiKey?.trim());
  const isConnected = availableModels.length > 0;
  // Settings only apply on Save. With no visible signal, a fully configured
  // provider can sit unsaved while the app keeps using the previous one —
  // which reads as "it isn't working" rather than "you haven't saved".
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(localSettings) !== JSON.stringify(buildLocalSettings(settings)),
    [localSettings, settings],
  );

  useEffect(() => {
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
  }, [localSettings.customLLM?.apiUrl, selectedProvider, localSettings.useCustomLLM]);

  const handleSave = () => {
    const llmToSave = localSettings.customLLM
      ? { ...localSettings.customLLM, enabled: !!localSettings.customLLM.enabled }
      : undefined;
    // Ensure known providers always save with canonical URL
    if (llmToSave) {
      const canonicalUrl = getDefaultApiUrl(llmToSave.provider);
      if (canonicalUrl) llmToSave.apiUrl = canonicalUrl;
    }
    // File the current key under ITS OWN provider, so configuring a second
    // provider no longer destroys the first. The main process merges this map
    // against what is already saved, so providers not touched here keep their
    // keys; an explicit empty string is what clears one.
    const nextProviderKeys: Record<string, string> = { ...(localSettings.providerApiKeys || {}) };
    if (llmToSave?.provider) {
      const typedKey = (llmToSave.apiKey || '').trim();
      if (typedKey) nextProviderKeys[llmToSave.provider] = typedKey;
    }
    // The four dedicated fields stay in sync so an older build — which only
    // knows about these — still finds the key it expects.
    if (localSettings.anthropicApiKey?.trim()) nextProviderKeys.anthropic = localSettings.anthropicApiKey.trim();
    if (localSettings.openaiApiKey?.trim()) nextProviderKeys.openai = localSettings.openaiApiKey.trim();
    if (localSettings.geminiApiKey?.trim()) {
      nextProviderKeys['google-ai-studio'] = localSettings.geminiApiKey.trim();
      nextProviderKeys['google-gemini'] = localSettings.geminiApiKey.trim();
    }
    if (localSettings.moonshotApiKey?.trim()) nextProviderKeys.moonshot = localSettings.moonshotApiKey.trim();

    const nextSettings: SharedSettings = {
      ...localSettings,
      providerApiKeys: nextProviderKeys,
      customLLM: llmToSave,
      codeModel: (localSettings as any).codeModel?.trim() || undefined,
      codeApiKey: (localSettings as any).codeApiKey?.trim() || undefined,
      codeApiProvider: (localSettings as any).codeApiProvider || undefined,
      codeApiUrl: (localSettings as any).codeApiUrl?.trim() || undefined,
      searxngUrl: localSettings.searxngUrl?.trim() || undefined,
      tavilyApiKey: localSettings.tavilyApiKey?.trim() || undefined,
      serperApiKey: localSettings.serperApiKey?.trim() || undefined,
      anthropicApiKey: localSettings.anthropicApiKey?.trim() || undefined,
      openaiApiKey: localSettings.openaiApiKey?.trim() || undefined,
      geminiApiKey: localSettings.geminiApiKey?.trim() || undefined,
      stableHordeApiKey: (localSettings as any).stableHordeApiKey?.trim() || undefined,
      chatGuidelines: localSettings.chatGuidelines?.trim() || undefined,
      calendarIcsUrl: (localSettings as any).calendarIcsUrl?.trim() || undefined,
      defaultLocation: (localSettings as any).defaultLocation?.trim() || undefined,
    } as SharedSettings;
    // Also persist any extra keys that the local-only interface tracks
    (nextSettings as any).notificationsEnabled = (localSettings as any).notificationsEnabled;
    (nextSettings as any).notificationSound = (localSettings as any).notificationSound;
    (nextSettings as any).notificationDuration = (localSettings as any).notificationDuration;
    (nextSettings as any).messageDensity = (localSettings as any).messageDensity || 'comfortable';
    (nextSettings as any).hardwareProfile = (localSettings as any).hardwareProfile;
    (nextSettings as any).moaProposers = (localSettings as any).moaProposers;
    (nextSettings as any).moaAggregator = (localSettings as any).moaAggregator;
    (nextSettings as any).permissionPromptTimeoutMs = (localSettings as any).permissionPromptTimeoutMs;
    onSave(nextSettings);
    onClose();
  };

  const handleCancel = () => {
    setLocalSettings(buildLocalSettings(settings)); // Reset to original
    setAvailableModels([]);
    setModelFetchError(null);
    setModelsFetchedAt(null);
    onClose();
  };

  const handleFetchModels = async () => {
    const apiKey = localSettings.customLLM?.apiKey?.trim();
    const provider = selectedProvider;
    
    // For known providers, ALWAYS use the canonical URL (ignore any stale/wrong stored value)
    const defaultUrl = getDefaultApiUrl(provider);
    let apiUrl = defaultUrl || localSettings.customLLM?.apiUrl?.trim() || '';

    // Validate we have what we need (Claude Code is a local CLI — no URL to enter)
    if (!apiUrl && provider !== 'claude-code' && provider !== 'codex') {
      setModelFetchError('Enter your API URL');
      return;
    }

    if (!isCuratedProvider && providerRequiresApiKey && !apiKey) {
      setModelFetchError('Enter your API key first');
      return;
    }

    if (!(window as any).electron?.listCustomLLMModels) {
      setModelFetchError('Update HomeBot to fetch models automatically.');
      return;
    }

    setModelsLoading(true);
    setModelFetchError(null);

    // Update local state with the resolved URL
    setLocalSettings(prev => ({
      ...prev,
      customLLM: { ...(prev.customLLM || { ...defaultCustomLLM }), apiUrl }
    }));

    try {
      const result = await (window as any).electron.listCustomLLMModels({ apiUrl, apiKey, provider });
      if (result?.success && Array.isArray(result.models)) {
        setAvailableModels(result.models);
        setModelsFetchedAt(Date.now());
        // Keep cloud configured and ready, but local remains the default
        // until the user explicitly turns on cloud chats.
        if (result.models.length > 0) {
          setLocalSettings(prev => {
            // Only keep the existing selection if THIS provider offers it.
            // Otherwise a model from the previous provider survives the switch
            // (e.g. gemini-2.5-flash left selected under claude-code) and the
            // request goes out naming a model the provider has never heard of.
            const current = prev.customLLM?.model;
            const stillValid = !!current && result.models.some((m: any) => m.id === current);
            return {
              ...prev,
              customLLM: {
                ...(prev.customLLM || { ...defaultCustomLLM }),
                model: stillValid ? current : result.models[0].id,
                apiUrl,
                enabled: true
              }
            };
          });
        }
      } else {
        throw new Error(result?.error || 'No models returned.');
      }
    } catch (err: any) {
      setAvailableModels([]);
      setModelsFetchedAt(null);
      setModelFetchError(err?.message || 'Connection failed. Check your API key.');
    } finally {
      setModelsLoading(false);
    }
  };

  return {
    defaultModels,
    defaultCustomLLM,
    getDefaultApiUrl,
    buildLocalSettings,
    ollamaModels,
    confirmDialog,
    confirmDestructive,
    localSettings,
    setLocalSettings,
    uncensoredMode,
    setUncensoredMode,
    permissions,
    setPermissions,
    showTelemetryModal,
    setShowTelemetryModal,
    availableModels,
    setAvailableModels,
    modelsLoading,
    setModelsLoading,
    panelRef,
    modelFetchError,
    setModelFetchError,
    setModelsFetchedAt,
    installedOllamaModels,
    setInstalledOllamaModels,
    deletingModel,
    modelDeleteError,
    deleteInstalledModel,
    openSections,
    setOpenSections,
    toggleSection,
    perfStats,
    setPerfStats,
    perfHistory,
    setPerfHistory,
    perfLoading,
    setPerfLoading,
    loadPerfStats,
    n8nTesting,
    setN8nTesting,
    n8nTestResult,
    setN8nTestResult,
    micDevices,
    setMicDevices,
    refreshMicDevices,
    sysCheck,
    setSysCheck,
    sysCheckLoading,
    setSysCheckLoading,
    sysCheckError,
    setSysCheckError,
    runSystemCheck,
    reportCopied,
    setReportCopied,
    copySupportReport,
    PERMISSION_DESCRIPTIONS,
    DANGEROUS_PERMISSIONS,
    telemetryLog,
    setTelemetryLog,
    showTelemetryDashboard,
    setShowTelemetryDashboard,
    showPermissionHistory,
    setShowPermissionHistory,
    showTrustPanel,
    setShowTrustPanel,
    gpuInfo,
    setGpuInfo,
    handleDetectGpu,
    handleManualVram,
    profileVramGB,
    effectiveVramGB,
    effectiveProfile,
    getModelFit,
    modelFitLabel,
    applyRecommendation,
    licenseStatus,
    setLicenseStatus,
    licenseKeyInput,
    setLicenseKeyInput,
    licenseBusy,
    setLicenseBusy,
    licenseMessage,
    setLicenseMessage,
    upgradePrompt,
    setUpgradePrompt,
    loadLicenseStatus,
    handleActivateLicense,
    handleDeactivateLicense,
    scheduledJobs,
    setScheduledJobs,
    showJobForm,
    setShowJobForm,
    jobForm,
    setJobForm,
    loadJobs,
    mcpServers,
    setMcpServers,
    mcpStatus,
    setMcpStatus,
    showMcpForm,
    setShowMcpForm,
    mcpForm,
    setMcpForm,
    refreshTelemetryLog,
    telemetryLogPreview,
    loadMcpServers,
    handleUncensoredToggle,
    selectedProvider,
    curatedProviders,
    isCuratedProvider,
    isClaudeCode,
    isSubscriptionCli,
    providerRequiresApiKey,
    hasApiKey,
    isConnected,
    hasUnsavedChanges,
    handleSave,
    handleCancel,
    handleFetchModels,
    settings,
    onSave,
    onClose,
  };
}

export type SettingsState = ReturnType<typeof useSettingsState>;
