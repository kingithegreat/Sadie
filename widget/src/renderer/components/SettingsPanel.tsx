import { useState, useEffect, useRef } from 'react';
import TelemetryConsentModal from './TelemetryConsentModal';
import TelemetryDashboard from './TelemetryDashboard';
import type { Settings as SharedSettings, CustomLLMConfig, CustomModelInfo, ScheduledJob } from '../../shared/types';

interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
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
  tavilyApiKey?: string;
  serperApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  stableHordeApiKey?: string;
  codeModel?: string;
  codeApiKey?: string;
  codeApiProvider?: 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'deepseek' | 'google-ai-studio' | 'google-gemini' | 'huggingface' | 'cerebras' | 'sambanova' | 'together' | 'custom';
  codeApiUrl?: string;
  chatGuidelines?: string;
  calendarIcsUrl?: string;
  notificationsEnabled?: boolean;
  notificationSound?: boolean;
  notificationDuration?: number;
  messageDensity?: 'compact' | 'comfortable' | 'spacious';
  moaEnabled?: boolean;
  moaProposers?: string[];
  moaAggregator?: string;
  hardwareProfile?: '4gb' | '8gb' | '16gb+';
  defaultLocation?: string;
}

interface SettingsPanelProps {
  settings: SharedSettings;
  onSave: (settings: SharedSettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onSave,
  onClose
}) => {
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
    // Auto-fill API key from saved provider keys if not already set
    if (!llm.apiKey) {
      if (llm.provider === 'anthropic' && source.anthropicApiKey) {
        llm.apiKey = source.anthropicApiKey;
      } else if (llm.provider === 'openai' && source.openaiApiKey) {
        llm.apiKey = source.openaiApiKey;
      } else if ((llm.provider === 'google-ai-studio' || llm.provider === 'google-gemini') && source.geminiApiKey) {
        llm.apiKey = source.geminiApiKey;
      }
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
      tavilyApiKey: source.tavilyApiKey || '',
      serperApiKey: source.serperApiKey || '',
      anthropicApiKey: source.anthropicApiKey || '',
      openaiApiKey: source.openaiApiKey || '',
      geminiApiKey: source.geminiApiKey || '',
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
      defaultLocation: source.defaultLocation || ''
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
    cloud: true,
    api_keys: true,
    appearance: true,
    permissions: true,
    advanced: true,
  });
  const toggleSection = (id: string) => setOpenSections(s => ({ ...s, [id]: !s[id] }));

  // Fetch installed Ollama models on mount
  useEffect(() => {
    window.electron?.listOllamaModels?.().then(res => {
      if (res?.success && res.models) setInstalledOllamaModels(res.models);
    }).catch(() => {});
  }, []);

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
    git_commit: 'Create a git commit. Modifies your repository.',
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
  ]);

  const [telemetryLog, setTelemetryLog] = useState<string[]>([]);
  const [showTelemetryDashboard, setShowTelemetryDashboard] = useState(false);

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
  const curatedProviders = ['openai', 'anthropic', 'groq', 'deepseek', 'google-ai-studio', 'google-gemini', 'huggingface', 'cerebras', 'sambanova', 'together'];
  const isCuratedProvider = curatedProviders.includes(selectedProvider);
  const providerRequiresApiKey = selectedProvider !== 'custom';
  const hasApiKey = Boolean(localSettings.customLLM?.apiKey?.trim());
  const isConnected = availableModels.length > 0;

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
    const nextSettings: SharedSettings = {
      ...localSettings,
      customLLM: llmToSave,
      codeModel: (localSettings as any).codeModel?.trim() || undefined,
      codeApiKey: (localSettings as any).codeApiKey?.trim() || undefined,
      codeApiProvider: (localSettings as any).codeApiProvider || undefined,
      codeApiUrl: (localSettings as any).codeApiUrl?.trim() || undefined,
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

    // Validate we have what we need
    if (!apiUrl) {
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
          setLocalSettings(prev => ({
            ...prev,
            customLLM: { 
              ...(prev.customLLM || { ...defaultCustomLLM }), 
              model: prev.customLLM?.model || result.models[0].id,
              apiUrl,
              enabled: true
            }
          }));
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

  return (
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        tabIndex={-1}
      >
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="settings-body">
        {/* ── General ── */}
        <button type="button" className={`sp-section-toggle${openSections.general ? ' open' : ''}`} onClick={() => toggleSection('general')}>
          <span className="sp-section-arrow">{openSections.general ? '▾' : '▸'}</span> General
        </button>
        {openSections.general && <>
        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.alwaysOnTop}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  alwaysOnTop: e.target.checked
                })
              }
            />
            <span>Always on top</span>
          </label>
          <small className="setting-hint">Keep the HomeBot window above all other windows.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎨 Theme</label>
          <div className="theme-selector">
            {(['dark', 'light', 'system'] as const).map(t => (
              <button
                key={t}
                className={`theme-btn ${(localSettings as any).theme === t || (!((localSettings as any).theme) && t === 'dark') ? 'active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, theme: t } as any)}
                aria-label={`${t} theme`}
              >
                {t === 'dark' ? '🌙' : t === 'light' ? '☀️' : '💻'} {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <small className="setting-hint">Choose a colour scheme. System matches your OS preference.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">n8n URL</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.n8nUrl}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                n8nUrl: e.target.value
              })
            }
            placeholder="http://localhost:5678"
          />
          <small className="setting-hint">URL of your local n8n instance for workflow automation. Requires Docker Desktop running n8n.</small>
        </div>
        </>}

        {/* ── Models ── */}
        <button type="button" className={`sp-section-toggle${openSections.models ? ' open' : ''}`} onClick={() => toggleSection('models')}>
          <span className="sp-section-arrow">{openSections.models ? '▾' : '▸'}</span> Models
        </button>
        {openSections.models && <>
        <div className="setting-group">
          <label className="setting-label">Chat model</label>
          <div className="model-grid">
            {/* Show installed Ollama models with hardware-aware recommendations. */}
            {(installedOllamaModels.length > 0
              ? installedOllamaModels.map(m => {
                  const known = ollamaModels.find(o => m.name === o.id || m.name.startsWith(o.id.split(':')[0]));
                  return {
                    id: m.name,
                    name: known?.name || m.name,
                    description: known?.description || `${(m.size / (1024*1024*1024)).toFixed(1)}GB`,
                    sizeGB: known?.sizeGB || (m.size / (1024*1024*1024)),
                    recommendedFor: known?.recommendedFor,
                    installed: true,
                  };
                })
              : ollamaModels.map(m => ({ ...m, installed: false }))
            ).sort((a, b) => {
              const rank: Record<string, number> = { recommended: 0, ok: 1, tight: 2, over: 3, unknown: 4 };
              return (rank[getModelFit(a)] ?? 4) - (rank[getModelFit(b)] ?? 4);
            }).map((model) => {
              const fit = getModelFit(model);
              const fitLabel = modelFitLabel(fit);
              return (
                <button
                  key={model.id}
                  className={`model-card ${localSettings.chatModel === model.id ? 'active' : ''} ${fit !== 'ok' && fit !== 'unknown' ? `model-fit-${fit}` : ''}`}
                  title={fit === 'over' ? `This model is larger than the detected ${effectiveVramGB} GB VRAM and may fall back to CPU or fail to load.` : undefined}
                  onClick={() =>
                    setLocalSettings({
                      ...localSettings,
                      chatModel: model.id
                    })
                  }
                >
                  <div className="model-card-label">
                    {model.name}
                    {fitLabel && <span className="model-fit-badge">{fitLabel}</span>}
                  </div>
                  <p className="model-card-desc">{model.description}</p>
                </button>
              );
            })}
          </div>
          <small className="setting-hint">
            {installedOllamaModels.length > 0
              ? `Showing ${installedOllamaModels.length} installed model(s). Recommendations are based on ${effectiveVramGB ? `${effectiveVramGB} GB VRAM` : 'your hardware profile'}; you can still choose any model.`
              : 'Ollama offline — showing recommended models. Custom APIs override this.'}
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Model routing</label>
          <select
            aria-label="Model routing mode"
            className="setting-input"
            value={localSettings.modelRoutingMode || 'prompt'}
            onChange={(e) => setLocalSettings({
              ...localSettings,
              modelRoutingMode: e.target.value as 'off' | 'prompt' | 'auto'
            })}
          >
            <option value="off">Off — never override my chosen model</option>
            <option value="prompt">Prompt — suggest a better model for the task</option>
            <option value="auto">Auto — switch requests automatically</option>
          </select>
          <small className="setting-hint">Controls whether HomeBot only suggests stronger local models for a task or applies them automatically.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Uncensored model</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.uncensoredModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                uncensoredModel: e.target.value || defaultModels.uncensoredModel
              })
            }
            placeholder={defaultModels.uncensoredModel}
          />
          <small className="setting-hint">Used when 🔓 Uncensored Mode is enabled (tools stay disabled).</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Vision model</label>
          <select
            aria-label="Vision model"
            className="setting-input"
            value={[
              'llava:latest', 'llava:7b', 'llava:13b',
              'llava-llama3:latest', 'bakllava:latest',
              'moondream:latest', 'minicpm-v:latest',
            ].includes(localSettings.visionModel || '') ? (localSettings.visionModel || 'llava:latest') : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                setLocalSettings({ ...localSettings, visionModel: e.target.value });
              }
            }}
          >
            <option value="llava:latest">llava:latest (recommended, 4.7 GB)</option>
            <option value="llava:7b">llava:7b (4.7 GB)</option>
            <option value="llava:13b">llava:13b (8.0 GB)</option>
            <option value="llava-llama3:latest">llava-llama3:latest (5.5 GB)</option>
            <option value="bakllava:latest">bakllava:latest (4.7 GB)</option>
            <option value="moondream:latest">moondream:latest (1.7 GB, fast)</option>
            <option value="minicpm-v:latest">minicpm-v:latest (5.6 GB)</option>
            <option value="__custom__">Custom…</option>
          </select>
          {(![
            'llava:latest', 'llava:7b', 'llava:13b',
            'llava-llama3:latest', 'bakllava:latest',
            'moondream:latest', 'minicpm-v:latest',
          ].includes(localSettings.visionModel || '')) && (
            <input
              type="text"
              className="setting-input sp-vision-input"
              value={localSettings.visionModel || ''}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  visionModel: e.target.value || defaultModels.visionModel
                })
              }
              placeholder={defaultModels.visionModel}
            />
          )}
          <small className="setting-hint">Used automatically when images are attached. Must be a vision-capable Ollama model.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">💻 Code model</label>
          <input
            type="text"
            className="setting-input"
            value={(localSettings as any).codeModel || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                codeModel: e.target.value
              } as any)
            }
            placeholder={defaultModels.codeModel}
          />
          <small className="setting-hint">Local Ollama model for coding. Leave blank to use the chat model. Recommended: <code>qwen2.5-coder:7b</code> (~4.4GB VRAM). If a Code API key is set below, it takes priority over this.</small>
        </div>
        </>}

        {/* ── Cloud & Integration ── */}
        <button type="button" className={`sp-section-toggle${openSections.cloud ? ' open' : ''}`} onClick={() => toggleSection('cloud')}>
          <span className="sp-section-arrow">{openSections.cloud ? '▾' : '▸'}</span> Cloud &amp; Integration
        </button>
        {openSections.cloud && <>
        <div className="setting-group">
          <label className="setting-label">🔑 Code model — Cloud API (optional)</label>
          <div className="api-key-row">
            <select
              className="setting-input provider-select"
              title="Code API provider"
              value={(localSettings as any).codeApiProvider || 'openai'}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiProvider: e.target.value as any } as any)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter (all models, one key)</option>
              <option value="groq">Groq (free tier — Llama, Gemma, Mixtral)</option>
              <option value="deepseek">DeepSeek (GPT-4 quality, ~20x cheaper)</option>
              <option value="google-ai-studio">Google AI Studio (Gemini, free tier)</option>
              <option value="google-gemini">Google Gemini Native API</option>
              <option value="huggingface">Hugging Face (free tier — open-source models)</option>
              <option value="cerebras">Cerebras (free tier — fastest inference)</option>
              <option value="sambanova">SambaNova (free tier — Llama, DeepSeek)</option>
              <option value="together">Together AI ($5 free credits, 200+ models)</option>
              <option value="custom">Custom URL</option>
            </select>
            <input
              type="password"
              className="setting-input api-key-input"
              value={(localSettings as any).codeApiKey || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiKey: e.target.value } as any)}
              placeholder="API key (sk-...)" 
            />
          </div>
          {(localSettings as any).codeApiProvider === 'custom' && (
            <input
              type="text"
              className="setting-input"
              value={(localSettings as any).codeApiUrl || ''}
              onChange={(e) => setLocalSettings({ ...localSettings, codeApiUrl: e.target.value } as any)}
              placeholder="Custom API base URL (e.g. http://localhost:8080/v1)"
            />
          )}
          <small className="setting-hint">Paste an API key to route all coding queries to a cloud model. The model name comes from the <em>Code model</em> field above (e.g. <code>gpt-4o</code>, <code>claude-opus-4-20250514</code>). Leave blank to use local Ollama.</small>
        </div>
        {/* Hardware Profile — applies safe model defaults for the card's VRAM */}
        <div className="setting-group">
          <label className="setting-label">🖥️ Hardware Profile</label>
          <div className="density-options">
            {(['4gb', '8gb', '16gb+'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`hw-profile-btn${localSettings.hardwareProfile === p ? ' active' : ''}`}
                onClick={() => {
                  const profileDefaults: Record<string, Partial<Settings>> = {
                    '4gb':   { chatModel: 'qwen2.5:7b', visionModel: 'moondream', uncensoredModel: 'dolphin-mistral:7b', moaEnabled: false },
                    '8gb':   { chatModel: 'qwen2.5:7b', visionModel: 'moondream', uncensoredModel: 'dolphin-mistral:7b', moaEnabled: false },
                    '16gb+': { chatModel: 'gemma4:e4b',  visionModel: 'moondream',  uncensoredModel: 'dolphin-mistral:7b' },
                  };
                  setLocalSettings({ ...localSettings, ...(profileDefaults[p] || {}), hardwareProfile: p });
                }}
              >
                {p === '4gb' ? '4 GB' : p === '8gb' ? '8 GB' : '16 GB+'}
              </button>
            ))}
          </div>
          <small className="setting-hint">
            Applies safe model defaults for your GPU.&nbsp;
            <strong>4 GB:</strong> qwen2.5:7b + moondream.&nbsp;
            <strong>8 GB:</strong> qwen2.5:7b + moondream.&nbsp;
            <strong>16 GB+:</strong> gemma4:e4b + moondream + MoA recommended.
            Auto-detected on first launch — only change if it was wrong.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Default Location</label>
          <input
            type="text"
            className="setting-input"
            value={(localSettings as any).defaultLocation || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                defaultLocation: e.target.value
              } as any)
            }
            placeholder="e.g. Auckland, London, New York"
          />
          <small className="setting-hint">Used for weather queries when you don't specify a location.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Chat Guidelines</label>
          <textarea
            className="setting-input setting-textarea"
            value={localSettings.chatGuidelines || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                chatGuidelines: e.target.value
              })
            }
            placeholder="Add custom instructions here... (e.g., 'Always respond in a friendly tone', 'Format code using markdown')"
            rows={4}
          />
          <small className="setting-hint">Custom instructions appended to the system prompt for all conversations.</small>
        </div>
        </>}

        {/* ── Appearance & Notifications ── */}
        <button type="button" className={`sp-section-toggle${openSections.appearance ? ' open' : ''}`} onClick={() => toggleSection('appearance')}>
          <span className="sp-section-arrow">{openSections.appearance ? '▾' : '▸'}</span> Appearance &amp; Notifications
        </button>
        {openSections.appearance && <>
        {/* Google Calendar ICS */}
        <div className="setting-group">
          <label className="setting-label">📅 Google Calendar</label>
          <input
            type="password"
            className="setting-input"
            value={(localSettings as any).calendarIcsUrl || ''}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, calendarIcsUrl: e.target.value } as any)
            }
            placeholder="Paste your secret iCal URL from Google Calendar settings…"
          />
          <small className="setting-hint">
            Google Calendar → Settings → your calendar → "Secret address in iCal format". No sign-in required.
          </small>
        </div>

        {/* Notification Preferences */}
        <div className="setting-group">
          <label className="setting-label">🔔 Notifications</label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={(localSettings as any).notificationsEnabled !== false}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationsEnabled: e.target.checked } as any)
              }
            />
            <span>Show toast notifications</span>
          </label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={!!(localSettings as any).notificationSound}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, notificationSound: e.target.checked } as any)
              }
            />
            <span>Play notification sound</span>
          </label>
          <label className="setting-label">Toast duration</label>
          <select
            className="setting-input"
            aria-label="Toast notification duration"
            value={(localSettings as any).notificationDuration ?? 8000}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, notificationDuration: Number(e.target.value) } as any)
            }
          >
            <option value={3000}>Short (3s)</option>
            <option value={5000}>Medium (5s)</option>
            <option value={8000}>Long (8s)</option>
            <option value={15000}>Extra long (15s)</option>
          </select>
          <small className="setting-hint">Controls how long toast notifications stay visible.</small>
        </div>

        {/* Message Density */}
        <div className="setting-group">
          <label className="setting-label">📐 Message Density</label>
          <div className="density-options">
            {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
              <button
                key={d}
                className={`density-btn${(localSettings as any).messageDensity === d ? ' active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, messageDensity: d } as any)}
              >
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
          <small className="setting-hint">Controls spacing between messages in the chat.</small>
        </div>
        </>}

        {/* ── API Keys ── */}
        <button type="button" className={`sp-section-toggle${openSections.api_keys ? ' open' : ''}`} onClick={() => toggleSection('api_keys')}>
          <span className="sp-section-arrow">{openSections.api_keys ? '▾' : '▸'}</span> API Keys &amp; Cloud LLM
        </button>
        {openSections.api_keys && <>
        {/* Custom LLM API Section - Simplified */}
        <div className="setting-group custom-llm-section">
          <label className="setting-label">☁️ Cloud API (OpenAI, Anthropic, etc.)</label>
          
          {/* Step 1: Provider Selection */}
          <div className="provider-row">
            <select
              aria-label="Cloud API provider"
              className="setting-input provider-select"
              value={selectedProvider}
              onChange={(e) => {
                const newProvider = e.target.value as any;
                // Auto-fill API key from saved keys when switching providers
                let autoFillKey = localSettings.customLLM?.apiKey || '';
                if (newProvider === 'anthropic' && localSettings.anthropicApiKey) {
                  autoFillKey = localSettings.anthropicApiKey;
                } else if (newProvider === 'openai' && localSettings.openaiApiKey) {
                  autoFillKey = localSettings.openaiApiKey;
                } else if ((newProvider === 'google-ai-studio' || newProvider === 'google-gemini') && localSettings.geminiApiKey) {
                  autoFillKey = localSettings.geminiApiKey;
                }
                setLocalSettings({
                  ...localSettings,
                  customLLM: { 
                    ...localSettings.customLLM!, 
                    provider: newProvider,
                    apiUrl: getDefaultApiUrl(newProvider),
                    apiKey: autoFillKey,
                    model: '',
                    enabled: false
                  },
                  useCustomLLM: false
                });
                setAvailableModels([]);
                setModelFetchError(null);
                setModelsFetchedAt(null);
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openrouter">OpenRouter (all models, one key)</option>
              <option value="groq">Groq (free tier — Llama, Gemma, Mixtral)</option>
              <option value="deepseek">DeepSeek (GPT-4 quality, ~20x cheaper)</option>
              <option value="google-ai-studio">Google AI Studio (Gemini, free tier)</option>
              <option value="google-gemini">Google Gemini Native API</option>
              <option value="huggingface">Hugging Face (free tier — open-source models)</option>
              <option value="cerebras">Cerebras (free tier — fastest inference)</option>
              <option value="sambanova">SambaNova (free tier — Llama, DeepSeek)</option>
              <option value="together">Together AI ($5 free credits, 200+ models)</option>
              <option value="custom">Custom URL</option>
            </select>
          </div>

          {/* Step 2: API Key (or URL for custom) */}
          {selectedProvider === 'custom' ? (
            <div className="api-key-row">
              <input
                type="text"
                className="setting-input api-key-input"
                value={localSettings.customLLM?.apiUrl || ''}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    customLLM: { ...localSettings.customLLM!, apiUrl: e.target.value }
                  })
                }
                placeholder="https://your-api.com/v1"
              />
            </div>
          ) : null}
          
          <div className="api-key-row">
            <input
              type="password"
              className="setting-input api-key-input"
              value={localSettings.customLLM?.apiKey || ''}
              onChange={(e) => {
                const key = e.target.value;
                const update: any = {
                  ...localSettings,
                  customLLM: { ...localSettings.customLLM!, apiKey: key }
                };
                if (selectedProvider === 'anthropic') update.anthropicApiKey = key;
                else if (selectedProvider === 'openai') update.openaiApiKey = key;
                else if (selectedProvider === 'google-ai-studio' || selectedProvider === 'google-gemini') update.geminiApiKey = key;
                setLocalSettings(update);
              }}
              placeholder={
                selectedProvider === 'openai' ? 'sk-...' :
                selectedProvider === 'anthropic' ? 'sk-ant-...' :
                selectedProvider === 'groq' ? 'gsk_...' :
                selectedProvider === 'deepseek' ? 'sk-...' :
                selectedProvider === 'google-ai-studio' ? 'AIza...' :
                selectedProvider === 'google-gemini' ? 'AIza...' :
                'API Key'
              }
            />
            <button
              type="button"
              className={`button connect-btn ${isConnected ? 'connected' : ''}`}
              onClick={handleFetchModels}
              disabled={modelsLoading || (providerRequiresApiKey && !hasApiKey)}
            >
              {modelsLoading ? '...' : isConnected ? '✓ Connected' : 'Connect'}
            </button>
          </div>
          
          {modelFetchError && (
            <small className="setting-hint error-hint">{modelFetchError}</small>
          )}

          {/* Step 3: Model Selection - only show when connected */}
          {isConnected && (
            <div className="model-chips-section">
              <label className="setting-label chip-label">Select Model</label>
              <div className="custom-models-grid">
                {availableModels.map((model) => (
                  <button
                    type="button"
                    key={model.id}
                    className={`custom-model-chip ${localSettings.customLLM?.model === model.id ? 'active' : ''}`}
                    onClick={() =>
                      setLocalSettings((prev) => ({
                        ...prev,
                        customLLM: { ...(prev.customLLM || { ...defaultCustomLLM }), model: model.id }
                      }))
                    }
                  >
                    <span className="chip-name">{model.name || model.id}</span>
                    {model.costHint && (
                      <span className="chip-cost">{model.costHint}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status indicator */}
          {localSettings.customLLM?.enabled && localSettings.customLLM?.model && (
            <div className="custom-llm-status">
              <span className={`status-dot ${localSettings.useCustomLLM ? 'active' : ''}`}></span>
              {localSettings.useCustomLLM
                ? `Using ${localSettings.customLLM.model}`
                : `Connected: ${localSettings.customLLM.model} is available when you choose it`}
            </div>
          )}

          {/* Disable toggle - only show when connected */}
          {isConnected && (
            <label className="setting-label disable-toggle">
              <input
                type="checkbox"
                checked={localSettings.useCustomLLM || false}
                onChange={(e) =>
                  setLocalSettings({
                    ...localSettings,
                    useCustomLLM: e.target.checked
                  })
                }
              />
              <span>Use this API by default for chats</span>
            </label>
          )}
        </div>




        {/* ── Mixture of Agents (MoA) ─────────────────────────── */}
        <div className="setting-group">
          <label className="setting-label">{'🧠'} Mixture of Agents (MoA)</label>
          <small className="setting-hint sp-hint-mb">
            Route complex queries to multiple specialist models and aggregate the best answer.
            Simple queries always use the fast single-model path.
          </small>
          {/* GPU VRAM detection / manual input — always visible */}
          <div style={{ background: 'var(--input-bg, #1a1a2e)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <button type="button" className="model-card" style={{ padding: '6px 14px', flex: '0 0 auto' }}
                onClick={handleDetectGpu} disabled={gpuInfo.detecting}>
                {gpuInfo.detecting ? 'Detecting...' : `${'🔍'} Detect my GPU`}
              </button>
              <span style={{ fontSize: '12px', opacity: 0.7 }}>or enter VRAM manually:</span>
              <input type="range" min={2} max={48} step={1}
                value={gpuInfo.manualVram ?? gpuInfo.vramGB ?? 4}
                onChange={(e) => handleManualVram(parseInt(e.target.value, 10))}
                style={{ flex: 1 }} />
              <span style={{ fontWeight: 600, minWidth: '50px', textAlign: 'right' }}>
                {gpuInfo.manualVram ?? gpuInfo.vramGB ?? '?'} GB
              </span>
            </div>
            {gpuInfo.gpuName && (
              <small className="setting-hint" style={{ display: 'block', marginBottom: '4px' }}>
                {'🎮'} Detected: <strong>{gpuInfo.gpuName}</strong> ({gpuInfo.vramGB} GB VRAM)
              </small>
            )}
            {gpuInfo.recommendation?.mode === 'single' && (
              <div style={{ background: 'var(--bg-secondary, #16213e)', borderRadius: '6px', padding: '10px', marginTop: '6px' }}>
                <small style={{ color: 'var(--accent-color, #00d4ff)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  {'🚀'} Best setup for your GPU
                </small>
                <small className="setting-hint" style={{ display: 'block', marginBottom: '6px' }}>
                  {gpuInfo.recommendation.reason}
                  {' '}Drag files into the chat to index them with RAG for smarter answers.
                </small>
                <button type="button" className="model-card active" style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={applyRecommendation}>
                  Apply &mdash; use {gpuInfo.recommendation.model} + RAG
                </button>
              </div>
            )}
            {gpuInfo.recommendation?.mode === 'moa' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <small className="setting-hint" style={{ color: 'var(--accent-color, #00d4ff)' }}>
                  {'✨'} Recommended: <strong>{gpuInfo.recommendation.reason}</strong>
                </small>
                <button type="button" className="model-card active" style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={applyRecommendation}>
                  Apply
                </button>
              </div>
            )}
            {gpuInfo.vramGB !== null && !gpuInfo.recommendation && (
              <small className="setting-hint" style={{ color: 'var(--warning-color, #f59e0b)' }}>
                {'⚠️'} {gpuInfo.vramGB} GB may not be enough for local models.
              </small>
            )}
          </div>

          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.moaEnabled || false}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  moaEnabled: e.target.checked
                })
              }
            />
            <span>Enable Mixture of Agents</span>
            {gpuInfo.recommendation?.mode === 'single' && (
              <small style={{ marginLeft: '8px', color: 'var(--warning-color, #f59e0b)', fontSize: '11px' }}>
                (not recommended for {gpuInfo.vramGB ?? '<8'} GB VRAM)
              </small>
            )}
          </label>

          {localSettings.moaEnabled && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'balanced' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="Good mix of reasoning, coding, and general knowledge (needs 8+ GB VRAM)"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], moaAggregator: 'gemma4:e4b' })}>
                  <div className="model-card-label">{'⚖️'} Balanced</div>
                  <p className="model-card-desc">16+ GB GPUs</p>
                </button>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'codeHeavy' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="Optimised for programming and debugging tasks (needs 10+ GB VRAM)"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5-coder:7b', 'qwen2.5:7b'], moaAggregator: 'gemma4:e4b' })}>
                  <div className="model-card-label">{'💻'} Code-focused</div>
                  <p className="model-card-desc">16+ GB GPUs</p>
                </button>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'lightweight' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="Minimum MoA setup — two small proposers with capable aggregator (needs 8+ GB VRAM)"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], moaAggregator: 'qwen2.5:7b' })}>
                  <div className="model-card-label">{'🪶'} Lightweight</div>
                  <p className="model-card-desc">10+ GB GPUs</p>
                </button>
              </div>

              <label className="setting-sub-label sp-sub-label">Proposer Models (select 2+)</label>
              <small className="setting-hint sp-hint-mb">
                These models generate independent answers in parallel. Pick diverse models for best results.
                Use the presets above or make your own selection.
              </small>
              <div className="model-grid">
                {ollamaModels
                  .filter(m => m.id !== 'llava:latest')
                  .map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-card ${(localSettings.moaProposers || []).includes(model.id) ? 'active' : ''}`}
                      onClick={() => {
                        const current = localSettings.moaProposers || [];
                        setLocalSettings({
                          ...localSettings,
                          moaProposers: current.includes(model.id)
                            ? current.filter((m: string) => m !== model.id)
                            : [...current, model.id]
                        });
                      }}
                    >
                      <div className="model-card-label">{model.name}</div>
                      <p className="model-card-desc">{model.description}</p>
                    </button>
                  ))}
              </div>

              <label className="setting-sub-label sp-sub-label">Aggregator Model</label>
              <small className="setting-hint sp-hint-mb">
                This model synthesises the proposer outputs into a single high-quality answer.
                Should be your most capable model.
              </small>
              <div className="model-grid">
                {ollamaModels
                  .filter(m => m.id !== 'llava:latest')
                  .map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-card ${localSettings.moaAggregator === model.id ? 'active' : ''}`}
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          moaAggregator: model.id
                        })
                      }
                    >
                      <div className="model-card-label">{model.name}</div>
                      <p className="model-card-desc">{model.description}</p>
                    </button>
                  ))}
              </div>

              {(localSettings.moaProposers || []).length < 2 && (
                <small className="setting-hint" style={{ color: 'var(--warning-color, #f59e0b)' }}>
                  {'⚠️'} Select at least 2 proposer models for MoA to activate.
                </small>
              )}
            </>
          )}
        </div>

        <div className="setting-group">
          <label className="setting-label">{'\u{1F511}'} LLM API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Save your API keys here. They will auto-fill when you select the provider above.
          </small>
          <label className="setting-sub-label sp-sub-label">Anthropic API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.anthropicApiKey || ''}
            placeholder="sk-ant-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, anthropicApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For Claude models. Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">console.anthropic.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">OpenAI API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.openaiApiKey || ''}
            placeholder="sk-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, openaiApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For GPT models and DALL-E 3 image generation. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noreferrer noopener">platform.openai.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">Google Gemini API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.geminiApiKey || ''}
            placeholder="AIza..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, geminiApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For Gemini models. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">aistudio.google.com</a></small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎨 Image Generation</label>
          <small className="setting-hint sp-hint-mb">
            Images are generated via Stable Horde (free community-powered AI). Register at <a href="https://stablehorde.net" target="_blank" rel="noreferrer noopener">stablehorde.net</a> for a free API key and faster generation.
          </small>
          <label className="setting-sub-label sp-sub-label">Stable Horde API Key</label>
          <input
            type="password"
            className="setting-input"
            value={(localSettings as any).stableHordeApiKey || ''}
            placeholder="Anonymous (slow) — paste your free key for faster results"
            onChange={(e) =>
              setLocalSettings({ ...localSettings, stableHordeApiKey: e.target.value } as any)
            }
          />
          <small className="setting-hint">Without a key, generation uses the anonymous queue (~60-120 s). A free registered key drops this to ~10-20 s.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">�🔍 Search API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Add API keys for higher-quality web search results. Falls back to DuckDuckGo scraping if no keys are set.
          </small>
          <label className="setting-sub-label sp-sub-label">Tavily API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.tavilyApiKey || ''}
            placeholder="tvly-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, tavilyApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Primary search — AI-optimized results. Get a key at <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">tavily.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">Serper.dev API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.serperApiKey || ''}
            placeholder="Enter Serper.dev key..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, serperApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Secondary search — Google results via API. Get a key at <a href="https://serper.dev" target="_blank" rel="noreferrer noopener">serper.dev</a></small>
        </div>
        </>}

        {/* ── Permissions & Advanced ── */}
        <button type="button" className={`sp-section-toggle${openSections.permissions ? ' open' : ''}`} onClick={() => toggleSection('permissions')}>
          <span className="sp-section-arrow">{openSections.permissions ? '▾' : '▸'}</span> Permissions &amp; Advanced
        </button>
        {openSections.permissions && <>
        <div className="setting-group">
          <label className="setting-label">Widget Hotkey (read-only)</label>
          <input
            type="text"
            className="setting-input"
            aria-label="Widget hotkey"
            value={localSettings.widgetHotkey}
            readOnly
            disabled
          />
          <small className="setting-hint">
            Hotkey configuration requires restart
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={uncensoredMode}
              onChange={(e) => handleUncensoredToggle(e.target.checked)}
            />
            <span>🔓 Uncensored Mode</span>
          </label>
          <small className={`setting-hint${uncensoredMode ? ' sp-hint-warning' : ''}`}>
            {uncensoredMode
              ? `Using ${(localSettings as any).uncensoredModel || 'dolphin-mistral:7b'} — No content filters`
              : 'Using standard model with safety filters'}
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={true}
              disabled
            />
            <span>🛡️ Telemetry (anonymous, opt-in)</span>
          </label>
          <small className="setting-hint sp-hint-block">
            Tool usage events are logged <strong>locally on this device only</strong>. Nothing is sent to an external server.
            Consent is recorded with a timestamp and can be reviewed or revoked in the Telemetry Consent Log below.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">Permissions</label>
          <small className="setting-hint">Enable or disable specific tools.</small>
          <div className="permission-grid space-y-2">
            {Object.keys(permissions).map((k) => {
              const isDangerous = DANGEROUS_PERMISSIONS.has(k);
              return (
                <div key={k} className="flex items-start gap-3">
                  <label
                    className="setting-label inline-flex items-center mr-3"
                    title={isDangerous ? `⚠ Dangerous — ${PERMISSION_DESCRIPTIONS[k] || k}` : (PERMISSION_DESCRIPTIONS[k] || k)}
                  >
                    <input
                      type="checkbox"
                      checked={!!permissions[k]}
                      onChange={(e) => {
                        const next = { ...permissions, [k]: e.target.checked };
                        setPermissions(next);
                        setLocalSettings({ ...localSettings, permissions: next } as any);
                      }}
                    />
                    <span className="ml-2">
                      {isDangerous && <span className="sp-warn-icon">⚠</span>}
                      {k.replace(/_/g, ' ')}
                    </span>
                  </label>
                  <div>
                    <small className={isDangerous ? 'sp-perm-danger' : 'text-zinc-500'}>
                      {PERMISSION_DESCRIPTIONS[k] || 'No description available.'}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="setting-group">
          <button
            className="button button-secondary"
            onClick={async () => {
              // Reset permissions to defaults by calling a dedicated IPC to avoid ambiguity
              const result = await (window as any).electron.resetPermissions();
              if (result) {
                const newPerms = (result as any).permissions || {};
                setPermissions(newPerms);
                setLocalSettings({ ...localSettings, permissions: newPerms } as any);
              }
            }}
          >
            Reset permissions to defaults
          </button>
        </div>
        <div className="setting-group">
          <label className="setting-label">Telemetry consent</label>
          <div className="flex items-center gap-2">
            <div className="text-sm text-zinc-400">{localSettings.telemetryConsentTimestamp ? `Consented: ${localSettings.telemetryConsentTimestamp} (v${localSettings.telemetryConsentVersion || '1.0'})` : 'No consent on record'}</div>
            <button className="button button-secondary" onClick={async () => {
              const r = await (window as any).electron.exportTelemetryConsent();
              if (r && r.success) {
                alert(`Consent exported to ${r.path}`);
              } else {
                alert(`Failed to export consent: ${r?.error}`);
              }
            }}>
              Export consent JSON
            </button>
          </div>
        </div>

        <div className="setting-group">
          <label className="setting-label">Telemetry Consent Log</label>
          <div className="flex items-center gap-2 mb-2">
            <button className="button button-secondary" onClick={async () => {
              await refreshTelemetryLog();
            }}>Refresh</button>
            <button className="button button-secondary" onClick={async () => {
              const r = await (window as any).electron.exportTelemetryConsent();
              if (r && r.success) alert(`Exported to ${r.path}`);
              else alert(`Export failed: ${r?.error}`);
            }}>Export</button>
            <button className="button button-secondary" onClick={() => setShowTelemetryDashboard(true)}>Open Telemetry Dashboard</button>
          </div>
          <div className="sp-telemetry-log">
            <pre className="sp-telemetry-pre">{telemetryLogPreview()}</pre>
          </div>
        </div>
        </>}
        <TelemetryConsentModal
          open={showTelemetryModal}
          onAccept={async () => {
            // Persist immediately so telemetry consent is logged
            const updated = await (window as any).electron.saveSettings({ ...localSettings, telemetryEnabled: true });
            setLocalSettings({ ...localSettings, telemetryEnabled: true, telemetryConsentTimestamp: updated.telemetryConsentTimestamp });
            setShowTelemetryModal(false);
          }}
          onDecline={() => {
            setShowTelemetryModal(false);
            setLocalSettings({ ...localSettings, telemetryEnabled: false });
          }}
          onClose={() => setShowTelemetryModal(false)}
        />
        {showTelemetryDashboard && <TelemetryDashboard open={showTelemetryDashboard} onClose={() => setShowTelemetryDashboard(false)} /> }

      {/* ── Scheduled Jobs ─────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3 className="settings-section-title sp-section-title">
          ⏰ Scheduled Jobs
          <small className="sp-section-subtitle">
            — recurring messages and reminders while HomeBot is open
          </small>
        </h3>

        {scheduledJobs.length === 0 ? (
          <p className="sp-empty-hint">
            No scheduled jobs yet. Add one below.
          </p>
        ) : (
          <div className="sp-list">
            {scheduledJobs.map((job) => (
              <div
                key={job.id}
                className="sp-list-row"
              >
                <div className="sp-list-row-left">
                  <span
                    className={job.enabled ? 'sp-status-dot-on' : 'sp-status-dot-off'}
                  />
                  <span className="sp-list-name">{job.name}</span>
                  <span className="sp-list-meta">
                    {job.dailyTime ? `daily @ ${job.dailyTime}` : `every ${job.intervalMinutes} min`}
                  </span>
                </div>
                <div className="sp-list-actions">
                  <button
                    className="button button-secondary sp-btn-sm"
                    onClick={async () => {
                      await (window as any).electron?.schedulerToggle?.(job.id, !job.enabled);
                      loadJobs();
                    }}
                  >
                    {job.enabled ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    className="button button-secondary sp-btn-sm-danger"
                    onClick={async () => {
                      if (confirm(`Delete job "${job.name}"?`)) {
                        await (window as any).electron?.schedulerRemove?.(job.id);
                        loadJobs();
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showJobForm ? (
          <div className="sp-form-box">
            <div className="sp-form-col">
              <input
                className="setting-input"
                placeholder="Job name (e.g. Morning briefing)"
                value={jobForm.name}
                onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
              />
              <input
                className="setting-input"
                placeholder="Message to show in chat when job fires"
                value={jobForm.message}
                onChange={(e) => setJobForm({ ...jobForm, message: e.target.value })}
              />
              <div className="sp-form-row">
                <select
                  aria-label="Job frequency type"
                  className="setting-input sp-select-auto"
                  value={jobForm.mode}
                  onChange={(e) => setJobForm({ ...jobForm, mode: e.target.value as 'interval' | 'daily' })}
                >
                  <option value="interval">Every N minutes</option>
                  <option value="daily">Daily at time</option>
                </select>
                {jobForm.mode === 'interval' ? (
                  <input
                    aria-label="Job interval in minutes"
                    className="setting-input"
                    type="number"
                    min={1}
                    placeholder="Minutes (e.g. 60)"
                    value={jobForm.intervalMinutes}
                    onChange={(e) => setJobForm({ ...jobForm, intervalMinutes: Math.max(1, Number(e.target.value)) })}
                  />
                ) : (
                  <input
                    aria-label="Daily job time"
                    className="setting-input"
                    type="time"
                    value={jobForm.dailyTime}
                    onChange={(e) => setJobForm({ ...jobForm, dailyTime: e.target.value })}
                  />
                )}
              </div>
              <div className="sp-mcp-actions">
                <button
                  className="button button-save sp-btn-save-sm"
                  onClick={async () => {
                    if (!jobForm.name.trim() || !jobForm.message.trim()) return;
                    await (window as any).electron?.schedulerAdd?.({
                      name: jobForm.name.trim(),
                      message: jobForm.message.trim(),
                      intervalMinutes: jobForm.intervalMinutes,
                      dailyTime: jobForm.mode === 'daily' ? jobForm.dailyTime : undefined,
                      enabled: true,
                    });
                    setJobForm({ name: '', message: '', mode: 'interval', intervalMinutes: 60, dailyTime: '09:00' });
                    setShowJobForm(false);
                    loadJobs();
                  }}
                >
                  Add Job
                </button>
                <button
                  className="button button-cancel sp-btn-save-sm"
                  onClick={() => setShowJobForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="button button-secondary sp-add-job-btn"
            onClick={() => setShowJobForm(true)}
          >
            + Add Job
          </button>
        )}
      </div>

      {/* ── MCP Servers ───────────────────────────────────────────────────── */}
      <div className="settings-section">
        <h3 className="settings-section-title sp-section-title">
          🔌 MCP Servers
          <small className="sp-section-subtitle">
            — extend HomeBot with any Model Context Protocol server
          </small>
        </h3>

        {/* Connected server list */}
        {mcpServers.length === 0 ? (
          <p className="sp-empty-hint">
            No MCP servers configured. Add one below.
          </p>
        ) : (
          <div className="sp-list">
            {mcpServers.map((srv: any) => {
              const live = mcpStatus.find((s: any) => s.name === srv.name);
              return (
                <div
                  key={srv.name}
                  className="sp-list-row"
                >
                  <div className="sp-list-row-left">
                    <span
                      className={live ? 'sp-status-dot-on' : (srv.enabled === false ? 'sp-status-dot-off' : 'sp-status-dot-err')}
                    />
                    <span className="sp-list-name">{srv.name}</span>
                    <span className="sp-list-meta">
                      {srv.type === 'stdio' ? srv.command : srv.url}
                    </span>
                    {live && (
                      <span className="sp-mcp-tools">
                        {live.toolCount} tool{live.toolCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="sp-list-actions">
                    <button
                      className="button button-secondary sp-btn-sm"
                      onClick={async () => {
                        await (window as any).electron?.mcpToggleServer?.(srv.name, srv.enabled === false);
                        loadMcpServers();
                      }}
                    >
                      {srv.enabled === false ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      className="button button-secondary sp-btn-sm-danger"
                      onClick={async () => {
                        if (confirm(`Remove MCP server "${srv.name}"?`)) {
                          await (window as any).electron?.mcpRemoveServer?.(srv.name);
                          loadMcpServers();
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add server form */}
        {showMcpForm ? (
          <div className="sp-form-box">
            <div className="sp-form-col">
              <div className="sp-form-row">
                <select
                  aria-label="MCP server type"
                  className="setting-input sp-select-auto"
                  value={mcpForm.type}
                  onChange={(e) => setMcpForm({ ...mcpForm, type: e.target.value as 'stdio' | 'sse' })}
                >
                  <option value="stdio">stdio (local)</option>
                  <option value="sse">SSE (remote)</option>
                </select>
                <input
                  className="setting-input"
                  placeholder="Server name (e.g. brave-search)"
                  value={mcpForm.name}
                  onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
                />
              </div>
              {mcpForm.type === 'stdio' ? (
                <>
                  <input
                    className="setting-input"
                    placeholder="Command (e.g. npx)"
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
                  />
                  <input
                    className="setting-input"
                    placeholder='Args, space-separated (e.g. -y @modelcontextprotocol/server-brave-search)'
                    value={mcpForm.args}
                    onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
                  />
                  <input
                    className="setting-input"
                    placeholder='Env vars as JSON (e.g. {"BRAVE_API_KEY":"your-key"})'
                    value={mcpForm.env}
                    onChange={(e) => setMcpForm({ ...mcpForm, env: e.target.value })}
                  />
                </>
              ) : (
                <input
                  className="setting-input"
                  placeholder="SSE URL (e.g. http://localhost:3000/sse)"
                  value={mcpForm.url}
                  onChange={(e) => setMcpForm({ ...mcpForm, url: e.target.value })}
                />
              )}
              <small className="sp-mcp-hint">
                Changes take effect after restarting HomeBot.
              </small>
              <div className="sp-mcp-actions">
                <button
                  className="button button-save sp-btn-save-sm"
                  onClick={async () => {
                    if (!mcpForm.name.trim()) return;
                    let envParsed: Record<string, string> | undefined;
                    try {
                      if (mcpForm.env.trim()) envParsed = JSON.parse(mcpForm.env);
                    } catch {
                      alert('Invalid env JSON');
                      return;
                    }
                    const config: any = mcpForm.type === 'stdio'
                      ? {
                          type: 'stdio',
                          name: mcpForm.name.trim(),
                          command: mcpForm.command.trim(),
                          args: mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : [],
                          env: envParsed,
                          enabled: true
                        }
                      : {
                          type: 'sse',
                          name: mcpForm.name.trim(),
                          url: mcpForm.url.trim(),
                          enabled: true
                        };
                    await (window as any).electron?.mcpAddServer?.(config);
                    setMcpForm({ type: 'stdio', name: '', command: '', args: '', env: '', url: '', enabled: true });
                    setShowMcpForm(false);
                    loadMcpServers();
                  }}
                >
                  Add Server
                </button>
                <button
                  className="button button-cancel sp-btn-save-sm"
                  onClick={() => setShowMcpForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            className="button button-secondary sp-add-job-btn"
            onClick={() => setShowMcpForm(true)}
          >
            + Add MCP Server
          </button>
        )}
      </div>

      {/* Backup / Restore */}
      <div className="settings-section sp-backup-section">
        <h3 className="section-title">Backup & Restore</h3>
        <p className="sp-backup-desc">
          Export all settings, conversations, and preferences as a single backup file, or restore from one.
        </p>
        <div className="sp-backup-btns">
          <button
            className="button button-secondary"
            onClick={async () => {
              const r = await (window as any).electron.exportSettings?.();
              if (r?.success) alert(`Backup saved to:\n${r.path}`);
              else alert(`Export failed: ${r?.error || 'Unknown error'}`);
            }}
          >
            Export Backup
          </button>
          <label className="button button-secondary sp-backup-import-label">
            Import Backup
            <input
              type="file"
              accept=".json"
              className="sp-backup-file-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const filePath = (file as any).path;
                if (!filePath) { alert('Could not read file path'); return; }
                if (!confirm('This will overwrite your current settings. Continue?')) return;
                const r = await (window as any).electron.importSettings?.(filePath);
                if (r?.success) {
                  alert('Settings restored! Restart HomeBot for full effect.');
                  try { await (window as any).electron.restartApp?.(); } catch {}
                } else {
                  alert(`Import failed: ${r?.error || 'Unknown error'}`);
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      </div>{/* end settings-body */}

      <div className="settings-footer">
        <button className="button button-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <button className="button button-save" onClick={handleSave}>
          Save
        </button>
      </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
