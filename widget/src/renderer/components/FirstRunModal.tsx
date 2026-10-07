import { useEffect, useState, useRef, useCallback } from 'react';
import type { Settings, CustomLLMConfig, SubscriptionCliStatus } from '../../shared/types';
import { recommendModelsForVram, recommendSetupPath } from '../../shared/hardware-presets';
import { assessModelDownloadFit, type ModelDownloadFit } from '../../shared/model-download-fit';
import { knownModelsFor } from '../../shared/subscription-models';

type Step = 'welcome' | 'setup' | 'done';
const STEPS: Step[] = ['welcome', 'setup', 'done'];

type SetupPath = 'local' | 'cloud' | null;

// `signupUrl` is where a key is actually obtained. Without it this step asked
// for something the reader has never heard of and gave them nowhere to get it —
// the hardest stop in the app, on one of the two paths off the very first
// screen. SettingsPanel already links out this way in five places; the wizard,
// which is the one place a first-time user lands, was the exception.
//
// Subscription choices come first for people who already have an account.
// Free API tiers precede paid-only API services for everyone else.
const CLOUD_PROVIDERS: { id: CustomLLMConfig['provider']; name: string; freeHint?: string; signupUrl?: string; subscription?: boolean }[] = [
  { id: 'codex', name: 'ChatGPT subscription', subscription: true },
  { id: 'claude-code', name: 'Claude subscription', subscription: true },
  // ── Free tier available — shown first ──
  { id: 'groq', name: 'Groq', freeHint: 'Free tier available', signupUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', name: 'OpenRouter', freeHint: 'Free models available', signupUrl: 'https://openrouter.ai/keys' },
  { id: 'google-ai-studio', name: 'Google AI Studio', freeHint: 'Free tier', signupUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'google-gemini', name: 'Google Gemini Native', freeHint: 'Free tier', signupUrl: 'https://aistudio.google.com/app/apikey' },
  { id: 'cerebras', name: 'Cerebras', freeHint: 'Free tier', signupUrl: 'https://cloud.cerebras.ai/' },
  { id: 'sambanova', name: 'SambaNova', freeHint: 'Free tier', signupUrl: 'https://cloud.sambanova.ai/apis' },
  { id: 'huggingface', name: 'Hugging Face', freeHint: 'Free inference', signupUrl: 'https://huggingface.co/settings/tokens' },
  // ── Paid only — deliberately last ──
  { id: 'anthropic', name: 'Anthropic', signupUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', name: 'OpenAI', signupUrl: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', signupUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'together', name: 'Together AI', signupUrl: 'https://api.together.ai/settings/api-keys' },
];

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5',
  openrouter: 'openai/gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  deepseek: 'deepseek-v4-flash',
  'google-ai-studio': 'gemini-2.5-flash',
  'google-gemini': 'gemini-2.5-flash',
  huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
  cerebras: 'llama-3.3-70b',
  sambanova: 'DeepSeek-R1-Distill-Llama-70B',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
};

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  'google-ai-studio': 'https://generativelanguage.googleapis.com/v1beta/openai',
  'google-gemini': 'https://generativelanguage.googleapis.com/v1beta',
  huggingface: 'https://api-inference.huggingface.co/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  together: 'https://api.together.xyz/v1',
};

type LocalSetupPhase =
  | 'checking'
  | 'ollama-missing'
  | 'downloading-ollama'
  | 'starting-ollama'
  | 'checking-models'
  | 'download-offered'
  | 'pulling-models'
  | 'models-missing'
  | 'ready';

// /api/tags includes embedding models, which cannot answer a chat request.
function chatModelNames(models: any[]): string[] {
  return models.filter(m => {
    const name = String(m.name || m);
    const families = m.details?.families || [m.details?.family];
    return !/embed|all-minilm|bge-|e5-/i.test(name)
      && !families.some((family: string | undefined) => /bert/i.test(family || ''));
  }).map(m => m.name || m);
}

function sameModel(installed: string, requested: string): boolean {
  const withTag = (name: string) => name.includes(':') ? name : `${name}:latest`;
  return withTag(installed) === withTag(requested);
}

interface ModelPullProgress {
  model: string;
  status: string;
  percent: number | null;
  completedMB: number | null;
  totalMB: number | null;
}

interface OllamaDownloadProgress {
  stage: string;
  percent: number;
  downloadedMB?: number;
  totalMB?: number;
}

export default function FirstRunModal({
  open,
  settings,
  onSave,
  onClose
}: {
  open: boolean;
  settings: Settings;
  onSave: (s: Settings) => void | Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [saveError, setSaveError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const localGeneration = useRef(0);
  const localCheckInFlight = useRef<number | null>(null);
  const localSetupActive = useRef(false);
  const downloadInFlight = useRef(false);
  const downloadGeneration = useRef<number | null>(null);
  const [backgroundDownload, setBackgroundDownload] = useState(false);
  const [downloadActive, setDownloadActive] = useState(false);
  const [plannedDownload, setPlannedDownload] = useState<{ name: string; sizeGB: number } | null>(null);
  const invalidateLocalCheck = useCallback(() => {
    localSetupActive.current = false;
    localGeneration.current += 1;
    localCheckInFlight.current = null;
    if (downloadInFlight.current) setBackgroundDownload(true);
  }, []);
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);

  const persistSetup = async (payload: Settings) => {
    // Closing unmounts this wizard and its operation lock. Keep setup mounted
    // until the authorized download and its inventory verification settle.
    if (saveInFlight.current || downloadInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(payload);
      onClose();
    } catch (error: any) {
      setSaveError(`Could not finish setup: ${error?.message || 'Please try again.'} Your choices are kept here; try again.`);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const [step, setStep] = useState<Step>('welcome');
  const [telemetryConsent, setTelemetryConsent] = useState(false);
  const [setupPath, setSetupPath] = useState<SetupPath>(null);

  // Local path state
  const [localPhase, setLocalPhase] = useState<LocalSetupPhase>('checking');
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<OllamaDownloadProgress | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelPullProgress, setModelPullProgress] = useState<ModelPullProgress | null>(null);
  const [modelsPulled, setModelsPulled] = useState<string[]>([]);
  const [gpuInfo, setGpuInfo] = useState<{ vramGB: number | null; gpuName: string | null } | null>(null);
  const [diskWarning, setDiskWarning] = useState<string | null>(null);
  // Which path to badge. Recomputed as detection lands; before that it returns
  // the uncertain/cloud default, which renders no badge and no advice line.
  const pathAdvice = recommendSetupPath(gpuInfo?.vramGB ?? null);
  // One flag for the badge AND the explanation, so they can never disagree.
  // recommendSetupPath returns a cloud default for unknown hardware — correct
  // as a fallback, but badging it would present a guess as a finding, and the
  // first thing a beginner sees would be advice we cannot actually support.
  const showRecommendation = !!gpuInfo && !pathAdvice.uncertain;
  const [diskOk, setDiskOk] = useState<boolean>(true);
  const [modelDiskFit, setModelDiskFit] = useState<ModelDownloadFit | null>(null);
  const gpuInfoRef = useRef<{ vramGB: number | null; gpuName: string | null } | null>(null);
  const freeDiskGBRef = useRef<number | null>(null);

  // Cloud path state
  const [cloudProvider, setCloudProvider] = useState<CustomLLMConfig['provider']>('groq');
  const selectedCloudProvider = CLOUD_PROVIDERS.find(p => p.id === cloudProvider);
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionCliStatus['status'] | null>(null);
  const isSubscriptionCli = cloudProvider === 'codex' || cloudProvider === 'claude-code';
  // Cloud means a service choice is prepared, never that its key was verified.
  // Local means a chat model was found in the service's installed inventory.
  const setupComplete =
    (setupPath === 'cloud' && cloudOk === true) ||
    (setupPath === 'local' && localPhase === 'ready');
  const [cloudModel, setCloudModel] = useState('');
  const cloudCheckGeneration = useRef(0);
  const cloudCheckInFlight = useRef<number | null>(null);

  const invalidateCloudCheck = useCallback((resetResult = true) => {
    // A generation, rather than value equality, also invalidates A -> B -> A.
    cloudCheckGeneration.current += 1;
    cloudCheckInFlight.current = null;
    setCloudTesting(false);
    if (resetResult) {
      setCloudOk(null);
      setCloudModel('');
      setSubscriptionStatus(null);
      setCloudError(null);
    }
  }, []);

  useEffect(() => {
    if (!open) { invalidateCloudCheck(); invalidateLocalCheck(); }
    return () => {
      // Late IPC replies must not update a closed or unmounted wizard.
      cloudCheckGeneration.current += 1;
      cloudCheckInFlight.current = null;
      localGeneration.current += 1;
      localSetupActive.current = false;
    };
  }, [open, invalidateCloudCheck, invalidateLocalCheck]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else document.querySelector<HTMLElement>('textarea:not([disabled]), [data-testid="chat-input"]')?.focus();
    };
  }, [open]);

  useEffect(() => { if (open) headingRef.current?.focus(); }, [open, step, setupPath]);

  useEffect(() => { setDraft(settings); }, [settings]);

  // Subscribe to pull progress events
  useEffect(() => {
    const unsub = (window as any).electron.onPullModelProgress?.((data: ModelPullProgress) => {
      if (downloadGeneration.current === localGeneration.current) setModelPullProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  // Subscribe to Ollama download progress events
  useEffect(() => {
    const unsub = (window as any).electron.onOllamaDownloadProgress?.((data: OllamaDownloadProgress) => {
      if (downloadGeneration.current === localGeneration.current) setDownloadProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  const detectHardware = useCallback(async () => {
    try {
      const res = await (window as any).electron.detectGpuVram?.();
      if (res?.success) {
        setGpuInfo({ vramGB: res.vramGB, gpuName: res.gpuName });
        gpuInfoRef.current = { vramGB: res.vramGB, gpuName: res.gpuName };
      }
    } catch { /* non-critical */ }
  }, []);

  // Detect the graphics card as soon as the wizard opens, not when the user
  // picks the local path.
  //
  // The welcome screen asks a brand-new user the hardest question in the app —
  // run it on this PC, or online? — and used to answer it with "runs on your
  // GPU", which is a question, not an answer. Detection already existed, but it
  // fired inside runLocalSetup(), i.e. only after they had committed to local,
  // so it could never inform the one choice it was most needed for.
  //
  // Deliberately not awaited: detectGpuVram shells out to nvidia-smi with a 5s
  // timeout and then falls back to Ollama's API, so blocking on it here would
  // stall the first screen on a machine that has neither. The cards render at
  // once and the recommendation appears when the reading lands.
  useEffect(() => {
    detectHardware();
  }, [detectHardware]);

  const assessInstalledModels = useCallback(async (generation: number) => {
    const current = () => localGeneration.current === generation;
    if (!current()) return;
    setLocalPhase('checking-models');
    const result = await (window as any).electron.listOllamaModels?.();
    if (!current()) return;
    if (!result?.success) throw new Error(result?.error || 'Could not check the installed AI models.');
    const chat = chatModelNames(result.models || []);
    setModels(chat);
    const rec = recommendModelsForVram(gpuInfoRef.current?.vramGB ?? null);
    const selected = chat.find(name => sameModel(name, draftRef.current.chatModel || ''))
      || chat.find(name => sameModel(name, rec.chat.id)) || chat[0];
    if (selected) {
      setDraft(d => ({ ...d, chatModel: selected, ...(rec.profile !== 'unknown' ? { hardwareProfile: rec.profile } : {}) }));
      setPlannedDownload(null);
      setModelDiskFit(null);
      setLocalPhase('ready');
      return true;
    }
    setPlannedDownload({ name: rec.chat.id, sizeGB: rec.chat.sizeGB });
    setModelDiskFit(assessModelDownloadFit({ sizeGB: rec.chat.sizeGB, freeGB: freeDiskGBRef.current }));
    setLocalPhase('download-offered');
    return false;
  }, []);

  const runLocalSetup = useCallback(async () => {
    if (localCheckInFlight.current !== null) return;
    const generation = ++localGeneration.current;
    localCheckInFlight.current = generation;
    const current = () => localGeneration.current === generation;
    setLocalPhase('checking');
    setOllamaError(null);
    setDiskWarning(null);
    setDiskOk(true);
    setModelDiskFit(null);
    setPlannedDownload(null);
    freeDiskGBRef.current = null;
    try {
      // The opt-in E2E mode retains its deterministic unavailable-service path.
      const env = await (window as any).electron?.getEnv?.();
      if (!current()) return;
      if (env?.isE2E) { setLocalPhase('ollama-missing'); return 'ollama-missing' as const; }
      await detectHardware();
      if (!current()) return;
      try {
        const diagnostics = await (window as any).electron.runDiagnostics?.();
        if (!current()) return;
        if (diagnostics?.disk) {
          setDiskOk(diagnostics.disk.ok);
          setDiskWarning(diagnostics.disk.warning ?? null);
          freeDiskGBRef.current = typeof diagnostics.disk.freeGB === 'number' ? diagnostics.disk.freeGB : null;
        }
      } catch { /* A missing disk reading is explained before downloading. */ }
      if (!current()) return;
      let running = false;
      try {
        const status = await (window as any).electron.checkConnection?.();
        if (!current()) return;
        running = status?.ollama === 'online';
      } catch { /* Offer installation or retry if the local service is unavailable. */ }
      if (!current()) return;
      if (!running) {
        const installation = await (window as any).electron.checkOllamaInstalled?.();
        if (!current()) return;
        if (!installation?.installed) { setLocalPhase('ollama-missing'); return 'ollama-missing' as const; }
        setLocalPhase('starting-ollama');
        const start = await (window as any).electron.startOllama?.();
        if (!current()) return;
        if (!start?.success) throw new Error(start?.error || 'Could not start local AI. Retry or finish setup later.');
      }
      const ready = await assessInstalledModels(generation);
      if (current()) return ready ? 'ready' as const : 'download-offered' as const;
    } catch (error: any) {
      if (!current()) return;
      setOllamaError(error?.message || 'Could not check local AI. Please retry.');
      setLocalPhase('models-missing');
      return 'models-missing' as const;
    } finally {
      if (localCheckInFlight.current === generation) localCheckInFlight.current = null;
    }
  }, [detectHardware, assessInstalledModels]);

  const finishLocalDownload = async (originalGeneration: number, kind: 'ollama' | 'model', downloadError: string | null) => {
    if (!localSetupActive.current) return;
    setBackgroundDownload(false);
    let generation = originalGeneration;
    const current = () => localSetupActive.current && localGeneration.current === generation;
    while (localSetupActive.current) {
      try {
        if (localGeneration.current !== generation) {
          // Back invalidates old replies, but returning to local setup creates
          // a new scope that must check the completed download's inventory.
          // Keep the download lock until a check in that scope completes, even
          // if navigation happens during the verification itself.
          localCheckInFlight.current = null;
          generation = localGeneration.current + 1;
          const phase = await runLocalSetup();
          if (!current()) continue;
          if (downloadError) {
            if (phase === 'models-missing') {
              setOllamaError(previous => `${downloadError} ${previous || 'Local setup could not be checked. Please retry.'}`);
            } else {
              setOllamaError(`${downloadError} Local setup has been checked again.${phase === 'ready' ? '' : ' Retry to check before downloading again.'}`);
            }
            if (phase !== 'ready') setLocalPhase(kind === 'ollama' && phase === 'ollama-missing' ? 'ollama-missing' : 'models-missing');
          } else if (kind === 'model' && phase === 'download-offered') {
            throw new Error('No chat model is installed yet. Retry to check before downloading again.');
          }
          return;
        }
        if (downloadError) throw new Error(downloadError);
        // Installing Ollama does not consent to a separate model download.
        const ready = await assessInstalledModels(generation);
        if (!current()) continue;
        if (kind === 'model' && !ready) {
          throw new Error('No chat model is installed yet. Retry the download or finish setup later.');
        }
        return;
      } catch (error: any) {
        if (!current()) continue;
        setOllamaError(error?.message || 'Could not check local AI. Please retry.');
        setLocalPhase(kind === 'ollama' ? 'ollama-missing' : 'models-missing');
        return;
      }
    }
  };

  const handleDownloadOllama = async () => {
    if (downloadInFlight.current || saveInFlight.current) return;
    const generation = ++localGeneration.current;
    downloadGeneration.current = generation;
    downloadInFlight.current = true;
    setDownloadActive(true);
    setBackgroundDownload(false);
    setLocalPhase('downloading-ollama');
    setOllamaError(null);
    setDownloadProgress({ stage: 'downloading', percent: 0 });
    let downloadError: string | null = null;
    try {
      const result = await (window as any).electron.downloadOllama?.();
      if (!result?.success) throw new Error(result?.error || 'Installation failed. Please retry.');
    } catch (error: any) {
      downloadError = error?.message || 'Installation failed. Please retry.';
    }
    try {
      await finishLocalDownload(generation, 'ollama', downloadError);
    } finally {
      downloadInFlight.current = false;
      downloadGeneration.current = null;
      setDownloadActive(false);
      setBackgroundDownload(false);
      if (localGeneration.current === generation) setDownloadProgress(null);
    }
  };

  const handleDownloadAI = async () => {
    if (downloadInFlight.current || saveInFlight.current || !plannedDownload || modelDiskFit?.fits === false || !diskOk) return;
    const generation = ++localGeneration.current;
    downloadGeneration.current = generation;
    downloadInFlight.current = true;
    setDownloadActive(true);
    setBackgroundDownload(false);
    setLocalPhase('pulling-models');
    setOllamaError(null);
    setModelsPulled([]);
    setModelPullProgress({ model: plannedDownload.name, status: 'Starting download...', percent: 0, completedMB: null, totalMB: null });
    let downloadError: string | null = null;
    try {
      const result = await (window as any).electron.pullModelStream?.(plannedDownload.name);
      if (!result?.success) throw new Error(result?.error || 'The AI download did not complete. Please retry.');
      if (localSetupActive.current && localGeneration.current === generation) setModelsPulled([plannedDownload.name]);
    } catch (error: any) {
      downloadError = error?.message || 'The AI download did not complete. Please retry.';
    }
    try {
      await finishLocalDownload(generation, 'model', downloadError);
    } finally {
      downloadInFlight.current = false;
      downloadGeneration.current = null;
      setDownloadActive(false);
      setBackgroundDownload(false);
      if (localGeneration.current === generation) setModelPullProgress(null);
    }
  };

  const testCloudConnection = async () => {
    if (cloudCheckInFlight.current !== null || (!isSubscriptionCli && !cloudApiKey.trim())) return;
    const generation = ++cloudCheckGeneration.current;
    cloudCheckInFlight.current = generation;
    const isCurrent = () => cloudCheckGeneration.current === generation;
    setCloudTesting(true);
    setCloudOk(null);
    setCloudModel('');
    setSubscriptionStatus(null);
    setCloudError(null);
    try {
      if (isSubscriptionCli) {
        const result = await (window as any).electron.checkSubscriptionCli?.(cloudProvider);
        if (!isCurrent()) return;
        const status = result?.status || 'unknown';
        setSubscriptionStatus(status);
        setCloudOk(status === 'ready');
        if (status === 'ready') setCloudModel(knownModelsFor(cloudProvider)[0]?.id || '');
        return;
      }
      // These discovery paths need saved Online consent. Configure their known
      // default here; setup does not claim to have contacted or validated it.
      if (cloudProvider === 'deepseek' || cloudProvider === 'google-ai-studio' || cloudProvider === 'google-gemini') {
        setCloudModel(PROVIDER_DEFAULT_MODELS[cloudProvider]);
        setCloudOk(true);
        return;
      }
      const apiUrl = PROVIDER_URLS[cloudProvider] || '';
      const res = await (window as any).electron.listCustomLLMModels?.({
        apiUrl,
        apiKey: cloudApiKey.trim(),
        provider: cloudProvider
      });
      if (!isCurrent()) return;
      const ok = res?.success && res.models?.length > 0;
      setCloudOk(ok);
      if (!ok) setCloudError(res?.error || 'Could not load a model choice. Try again or choose another service.');
      if (ok && res.models?.[0]?.id) {
        setCloudModel(res.models[0].id);
      }
    } catch (error: any) {
      if (!isCurrent()) return;
      if (isSubscriptionCli) setSubscriptionStatus('unknown');
      setCloudOk(false);
      setCloudError(error?.message || 'Could not prepare this service. Please try again.');
    } finally {
      if (isCurrent()) {
        cloudCheckInFlight.current = null;
        setCloudTesting(false);
      }
    }
  };

  const enterSetupStep = (path: SetupPath) => {
    invalidateCloudCheck();
    invalidateLocalCheck();
    setSetupPath(path);
    setStep('setup');
    if (path === 'local') {
      localSetupActive.current = true;
      runLocalSetup();
    }
  };

  const handleFinish = async () => {
    if (downloadInFlight.current) return;
    invalidateCloudCheck(false);
    invalidateLocalCheck();
    const payload: any = { ...draft, firstRun: false, telemetryEnabled: telemetryConsent };
    if (telemetryConsent) payload.telemetryConsentTimestamp = new Date().toISOString();

    if (setupPath === 'local' && localPhase === 'ready') {
      payload.uncensoredMode = false;
      payload.useCustomLLM = false;
      // A first coding request must also use an installed model, rather than
      // falling through to a default larger model that setup never downloaded.
      if (!models.some(name => sameModel(name, payload.codeModel || ''))) {
        payload.codeModel = payload.chatModel;
      }
      if (payload.customLLM) payload.customLLM = { ...payload.customLLM, enabled: false };
    }

    if (setupPath === 'cloud' && cloudOk === true && (isSubscriptionCli || cloudApiKey.trim())) {
      const apiUrl = PROVIDER_URLS[cloudProvider] || '';
      const model = cloudModel || PROVIDER_DEFAULT_MODELS[cloudProvider] || '';
      payload.useCustomLLM = true;
      // Fresh profiles default to local Uncensored Mode, which overrides cloud
      // routing. An explicit Online choice must make the chosen provider active.
      payload.uncensoredMode = false;
      payload.customLLM = {
        name: CLOUD_PROVIDERS.find(p => p.id === cloudProvider)?.name || 'Cloud LLM',
        apiUrl,
        apiKey: isSubscriptionCli ? '' : cloudApiKey.trim(),
        provider: cloudProvider,
        model,
        enabled: true
      };
      if (cloudProvider === 'anthropic') payload.anthropicApiKey = cloudApiKey.trim();
      else if (cloudProvider === 'openai') payload.openaiApiKey = cloudApiKey.trim();
      else if (cloudProvider === 'google-ai-studio' || cloudProvider === 'google-gemini') payload.geminiApiKey = cloudApiKey.trim();
    }

    await persistSetup(payload);
  };

  const handleSkip = async () => {
    if (downloadInFlight.current) return;
    invalidateCloudCheck(false);
    invalidateLocalCheck();
    const payload = { ...draft, firstRun: false, telemetryEnabled: false } as any;
    await persistSetup(payload);
  };

  if (!open) return null;

  const stepIndex = STEPS.indexOf(step);
  const localBusy = localPhase === 'checking' || localPhase === 'checking-models' || localPhase === 'downloading-ollama' || localPhase === 'starting-ollama' || localPhase === 'pulling-models';

  return (
    <div className="first-run-overlay">
      <div className="first-run-modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="first-run-step-title"
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]') || []);
          const first = controls[0], last = controls[controls.length - 1];
          if (!first) { event.preventDefault(); headingRef.current?.focus(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}>
        {/* Progress dots */}
        <div className="wizard-progress" role="img" aria-label={`Setup step ${stepIndex + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <div key={s} className={`wizard-dot${i <= stepIndex ? ' active' : ''}${s === step ? ' current' : ''}`} />
          ))}
        </div>

        <div className="first-run-content">
          {saveError && <p role="alert" className="wizard-error-detail">{saveError}</p>}
          {downloadActive && <p role="status" className="wizard-error-detail">{backgroundDownload ? 'The setup you started continues in the background. ' : 'Your download and setup check are still in progress. '}Setup stays open until they finish. Back can change the setup view, but skipping or finishing setup must wait. The download cannot be stopped here.</p>}
          {step === 'welcome' && (
            <div className="wizard-step">
              <div className="wizard-icon">✨</div>
              <h1 id="first-run-step-title" ref={headingRef} tabIndex={-1} className="first-run-title">Welcome to HomeBot</h1>
              <p className="first-run-subtitle">
                Your private AI desktop assistant. Where should it think?
              </p>
              <div className="wizard-path-cards">
                <button
                  type="button"
                  className={`wizard-path-card${setupPath === 'local' ? ' selected' : ''}${showRecommendation && pathAdvice.recommended === 'local' ? ' recommended' : ''}`}
                  onClick={() => enterSetupStep('local')}
                >
                  {showRecommendation && pathAdvice.recommended === 'local' && (
                    <span className="wizard-path-badge">Recommended for your PC</span>
                  )}
                  <span className="wizard-path-icon">🖥️</span>
                  <strong>On this PC</strong>
                  <span className="wizard-path-desc">
                    Chat is processed on this PC. No AI account needed. Initial downloads and optional internet tools use the internet.
                  </span>
                </button>
                <button
                  type="button"
                  className={`wizard-path-card${setupPath === 'cloud' ? ' selected' : ''}${showRecommendation && pathAdvice.recommended === 'cloud' ? ' recommended' : ''}`}
                  onClick={() => enterSetupStep('cloud')}
                >
                  {showRecommendation && pathAdvice.recommended === 'cloud' && (
                    <span className="wizard-path-badge">Recommended for your PC</span>
                  )}
                  <span className="wizard-path-icon">☁️</span>
                  <strong>Online</strong>
                  <span className="wizard-path-desc">
                    Your messages go to the AI service you choose. Some services offer free tiers; account limits and charges depend on the service.
                  </span>
                </button>
              </div>
              {/* The reason the app has an opinion. Only shown once detection
                  has actually produced a reading — an "unknown hardware"
                  disclaimer on the first screen would worry a beginner more
                  than the missing recommendation helps them. */}
              {gpuInfo && !pathAdvice.uncertain && (
                <p className="wizard-path-advice">{pathAdvice.reason}</p>
              )}
              <p className="wizard-path-reassure">
                Not sure? Pick either — you can change it later in Settings.
              </p>
            </div>
          )}

          {step === 'setup' && setupPath === 'local' && (
            <div className="wizard-step">
              <h2 id="first-run-step-title" ref={headingRef} tabIndex={-1} className="wizard-step-title">Local Setup</h2>

              {/* GPU info */}
              {gpuInfo && gpuInfo.vramGB && (
                <div className="wizard-status success wizard-gpu-info">
                  Detected: {gpuInfo.gpuName || 'GPU'} ({gpuInfo.vramGB.toFixed(1)} GB VRAM)
                </div>
              )}

              {/* Phase: Checking */}
              {localPhase === 'checking' && (
                <div className="wizard-status checking" role="status">
                  <span className="wizard-spinner" />Checking your system...
                </div>
              )}

              {/* Phase: Ollama missing — offer download */}
              {localPhase === 'ollama-missing' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status error">
                    <p>Ollama is not installed. HomeBot needs it for local AI.</p>
                  </div>
                  {ollamaError && <p className="wizard-error-detail">{ollamaError}</p>}
                  <div className="wizard-btn-row">
                    <button type="button" className="first-run-btn first-run-btn-primary" disabled={saving || downloadActive} onClick={handleDownloadOllama}>
                      Install Ollama automatically
                    </button>
                    <button type="button" className="first-run-btn first-run-btn-secondary" onClick={runLocalSetup}>
                      Retry
                    </button>
                  </div>
                  <p className="wizard-step-desc wizard-install-hint">
                    This downloads and installs the local AI service using the internet. You will choose whether to download a chat model afterwards.{' '}
                    Or <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">install manually</a>, then click Retry.
                  </p>
                </div>
              )}

              {/* Phase: Downloading Ollama */}
              {localPhase === 'downloading-ollama' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status checking" role="status">
                    <span className="wizard-spinner" />
                    {downloadProgress?.stage === 'downloading'
                      ? `Downloading Ollama... ${downloadProgress.percent}%${downloadProgress.totalMB ? ` (${downloadProgress.downloadedMB || 0} / ${downloadProgress.totalMB} MB)` : ''}`
                      : downloadProgress?.stage === 'installing'
                        ? 'Installing Ollama...'
                        : downloadProgress?.stage === 'starting'
                          ? 'Starting Ollama...'
                          : 'Setting up Ollama...'}
                  </div>
                  {downloadProgress && downloadProgress.stage === 'downloading' && (
                    <div className="wizard-progress-bar">
                      <div className="wizard-progress-fill" style={{ width: `${downloadProgress.percent}%` }} />
                    </div>
                  )}
                </div>
              )}

              {/* Phase: Starting Ollama */}
              {localPhase === 'starting-ollama' && (
                <div className="wizard-status checking" role="status">
                  <span className="wizard-spinner" />Starting Ollama...
                </div>
              )}

              {/* Disk space warning — shown whenever there is a warning, regardless of phase */}
              {diskWarning && (
                <div className={`wizard-status ${diskOk ? 'warning' : 'error'}`}>
                  💾 {diskWarning}
                </div>
              )}

              {/* Model-specific disk fit — the recommended chat model vs. free space */}
              {modelDiskFit && modelDiskFit.message && (
                <div className={`wizard-status ${modelDiskFit.severity === 'insufficient' ? 'error' : 'warning'}`}>
                  💾 {modelDiskFit.message}
                  {modelDiskFit.severity === 'insufficient' && ' Free up space before downloading AI.'}
                </div>
              )}

              {/* Phase: Checking models */}
              {localPhase === 'checking-models' && (
                <div className="wizard-status checking" role="status">
                  <span className="wizard-spinner" />Checking installed models...
                </div>
              )}

              {/* Phase: Pulling models */}
              {localPhase === 'download-offered' && plannedDownload && (
                <div className="wizard-setup-section">
                  <p className="wizard-step-desc">No chat AI is installed yet. Recommended: <strong>{plannedDownload.name}</strong> — approximately {plannedDownload.sizeGB.toFixed(1)} GB. Downloading needs an internet connection and free disk space. Chat runs on this PC afterwards.</p>
                  {freeDiskGBRef.current !== null && <p className="wizard-step-desc">Disk check reports {freeDiskGBRef.current.toFixed(1)} GB free.</p>}
                  {freeDiskGBRef.current === null && <p className="wizard-step-desc">Free disk space could not be checked. Make sure there is room for this download.</p>}
                  <button type="button" className="first-run-btn first-run-btn-primary" disabled={saving || downloadActive || !diskOk || modelDiskFit?.fits === false} onClick={handleDownloadAI}>Download AI</button>
                </div>
              )}
              {localPhase === 'pulling-models' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status checking" role="status">
                    <span className="wizard-spinner" />
                    Downloading chat AI
                  </div>
                  {modelPullProgress && (
                    <div className="wizard-model-pull-info">
                      <p className="wizard-pull-model-name">
                        {modelPullProgress.model}
                        {modelPullProgress.totalMB
                          ? ` — ${modelPullProgress.completedMB || 0} / ${modelPullProgress.totalMB} MB`
                          : modelPullProgress.status ? ` — ${modelPullProgress.status}` : ''}
                      </p>
                      <div className="wizard-progress-bar">
                        <div className="wizard-progress-fill" style={{ width: `${modelPullProgress.percent || 0}%` }} />
                      </div>
                    </div>
                  )}
                  {modelsPulled.length > 0 && (
                    <div className="wizard-pulled-list">
                      {modelsPulled.map(m => (
                        <span key={m} className="wizard-pulled-check">✓ {m}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Phase: Ready */}
              {localPhase === 'models-missing' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status error">{ollamaError}</div>
                  <button type="button" className="first-run-btn first-run-btn-primary" onClick={runLocalSetup}>Retry</button>
                </div>
              )}
              {localPhase === 'ready' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status success">Ollama is ready!</div>
                  {ollamaError && <div className="wizard-status warning">{ollamaError}</div>}
                  {models.length > 0 && (
                    <div className="wizard-model-compact">
                      <p className="wizard-step-desc">
                        {models.length} chat model{models.length > 1 ? 's' : ''} installed. Using: <strong>{draft.chatModel || models[0]}</strong>
                      </p>
                      {models.length > 0 && (
                        <select
                          className="first-run-input"
                          aria-label="Select chat model"
                          value={draft.chatModel || models[0]}
                          onChange={e => setDraft({ ...draft, chatModel: e.target.value })}
                        >
                          {models.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'setup' && setupPath === 'cloud' && (
            <div className="wizard-step">
              {/* "Pick a provider and paste your API key. Free tiers are
                  marked." was three insider words in one sentence, with no way
                  to get the thing being asked for. Say what these companies are,
                  what a key is in ordinary words, and link straight to the page
                  that issues one. */}
              <h2 id="first-run-step-title" ref={headingRef} tabIndex={-1} className="wizard-step-title">Connect an AI service</h2>
              {isSubscriptionCli ? (
                <p className="wizard-step-desc">Use your subscription already signed in on this PC. No API key is needed.</p>
              ) : (
              <p className="wizard-step-desc">
                These companies run the AI for you. Pick one, make a free account, and it
                gives you a long password called a key — paste that below. Check that service’s current limits and charges before using it. Saving a choice does not check the key or send a chat message.
              </p>
              )}

              <div className="wizard-cloud-provider-grid">
                {CLOUD_PROVIDERS.map(p => (
                  <button
                    type="button"
                    key={p.id}
                    className={`wizard-cloud-chip${cloudProvider === p.id ? ' selected' : ''}`}
                    onClick={() => { invalidateCloudCheck(); setCloudProvider(p.id); if (p.subscription) setCloudApiKey(''); }}
                  >
                    {p.name}
                    {p.freeHint && <span className="wizard-free-badge">free</span>}
                  </button>
                ))}
              </div>

              {/* The chip badge can only say "free"; the specific promise —
                  free tier vs free models vs free inference — renders here,
                  for the provider actually selected. Every entry's freeHint
                  text existed but was only ever tested for truthiness, so a
                  newcomer could never read what "free" commits them to. */}
              {selectedCloudProvider?.freeHint && (
                <p className="wizard-step-desc">
                  {selectedCloudProvider.name}: {selectedCloudProvider.freeHint}.
                </p>
              )}

              {/* Only shown once a provider is chosen, so it points at one
                  specific page rather than asking the reader to choose again. */}
              {selectedCloudProvider?.signupUrl && (
                <p className="wizard-step-desc wizard-install-hint">
                  No key yet?{' '}
                  <a href={selectedCloudProvider.signupUrl} target="_blank" rel="noopener noreferrer">
                    Get one from {selectedCloudProvider.name}
                  </a>
                  {' '}— it opens in your browser, then come back and paste it here.
                </p>
              )}

              {isSubscriptionCli ? (
                <div className="wizard-setup-section">
                  <p className="wizard-step-desc">
                    {cloudProvider === 'codex'
                      ? <>Uses ChatGPT plan limits through Codex. Install it with <code>npm install -g @openai/codex</code>, then sign in with <code>codex login</code>. Codex chat cannot use HomeBot tools.</>
                      : <>Requires Claude Code access on a Pro, Max, Team, or Enterprise plan. <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener noreferrer">Install Claude Code</a>, then sign in with <code>claude auth login</code>.</>}
                  </p>
                  <p className="wizard-step-desc">Check again after signing in. This check does not send a chat request.</p>
                </div>
              ) : (
                <input
                  aria-label="AI service key"
                  type="password"
                  className="first-run-input"
                  placeholder="Paste the key from your account page"
                  value={cloudApiKey}
                  onChange={e => { invalidateCloudCheck(); setCloudApiKey(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter' && cloudApiKey.trim()) testCloudConnection(); }}
                  autoComplete="off"
                />
              )}

              <div className="wizard-btn-row wizard-test-row">
                <button
                  type="button"
                  className="first-run-btn first-run-btn-primary"
                  onClick={testCloudConnection}
                  disabled={cloudTesting || (!isSubscriptionCli && !cloudApiKey.trim())}
                >
                  {cloudTesting ? 'Checking...' : isSubscriptionCli ? 'Check sign-in' : 'Prepare service'}
                </button>
              </div>

              {cloudOk === true && (
                <div className="wizard-status success" role="status">{isSubscriptionCli ? 'Subscription sign-in found. Ready to try a chat.' : 'Service choice prepared. Your key and ability to chat have not been verified.'}</div>
              )}
              {isSubscriptionCli && subscriptionStatus && subscriptionStatus !== 'ready' && (
                <div className="wizard-status warning">
                  {subscriptionStatus === 'missing'
                    ? 'The CLI is not installed or HomeBot cannot find it on this PC.'
                    : subscriptionStatus === 'signed-out'
                      ? 'The CLI is installed but has no active sign-in. Sign in, then check again.'
                      : subscriptionStatus === 'api-key'
                        ? 'The CLI is using an API key. Sign in with your subscription to use plan limits.'
                        : 'Could not confirm the subscription sign-in. You can try chat after setup, but it is not verified yet.'}
                </div>
              )}
              {!isSubscriptionCli && cloudOk === false && (
                <div className="wizard-status error" role="alert">{cloudError || 'Could not prepare this service. Please try again.'}</div>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="wizard-step">
              {/* "You're all set!" used to appear no matter what happened —
                  including straight after Skip, or after the cloud step with
                  nothing entered. A claim of success when nothing was set up
                  costs the app the user's trust in the first minute; say what
                  is actually true instead. */}
              <div className="wizard-icon">{setupComplete && setupPath === 'local' ? '✓' : '👋'}</div>
              <h2 id="first-run-step-title" ref={headingRef} tabIndex={-1} className="wizard-step-title">
                {setupComplete ? setupPath === 'cloud' ? 'Ready to try a message' : 'Ready to chat on this PC' : 'Ready when you are'}
              </h2>
              <p className="wizard-step-desc">
                {setupComplete
                  ? setupPath === 'cloud' && isSubscriptionCli
                    ? 'Your subscription is selected for chat. Send a message to confirm it can answer on this PC.'
                    : setupPath === 'cloud'
                      ? 'Your service choice will be saved. Your key has not been verified. Send a first message to find out whether this account can answer.'
                      : 'Your installed AI is selected for chat. After saving, type a message such as “Hello” in the chat box.'
                  : 'AI is not configured yet. You can finish setting up any time from Settings.'}
              </p>
              <div className="wizard-suggestions">
                <p>Start with a simple chat: “Hello, what can you help me with?”</p>
              </div>
              <label className="wizard-telemetry-consent">
                <input
                  type="checkbox"
                  checked={telemetryConsent}
                  onChange={(e) => setTelemetryConsent(e.target.checked)}
                />
                <span>
                  Help improve HomeBot by sharing anonymous usage statistics (feature counts and
                  error rates only). No personal data or conversation content is ever collected.
                  Off by default — you can change this any time in Settings.
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="first-run-footer">
          <button type="button" onClick={handleSkip} disabled={saving || downloadActive} className="first-run-btn first-run-btn-secondary">Skip setup</button>
          <div className="wizard-nav-btns">
            {step === 'setup' && (
              <button type="button" onClick={() => { invalidateCloudCheck(); invalidateLocalCheck(); setStep('welcome'); setSetupPath(null); }} className="first-run-btn first-run-btn-secondary">Back</button>
            )}
            {step === 'setup' && (
              <button
                type="button"
                onClick={() => { invalidateCloudCheck(false); invalidateLocalCheck(); setStep('done'); }}
                className="first-run-btn first-run-btn-primary"
                disabled={(setupPath === 'local' && (localBusy || (!diskOk && localPhase !== 'ready'))) || (setupPath === 'cloud' && !isSubscriptionCli && cloudOk !== true && cloudApiKey.trim().length > 0)}
              >
                {setupPath === 'local' && !diskOk && localPhase !== 'ready' ? 'Free up disk space first' : setupPath === 'local' && localPhase === 'ready' ? 'Next' : setupPath === 'local' && localBusy ? 'Setting up...' : setupPath === 'local' || (isSubscriptionCli && cloudOk !== true) ? 'Continue anyway' : 'Next'}
              </button>
            )}
            {step === 'done' && (
              <button type="button" onClick={handleFinish} disabled={saving || downloadActive} className="first-run-btn first-run-btn-primary">{saving ? 'Saving…' : 'Get Started'}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
