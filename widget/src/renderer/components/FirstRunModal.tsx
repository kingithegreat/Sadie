import { useEffect, useState, useRef, useCallback } from 'react';
import type { Settings, CustomLLMConfig } from '../../shared/types';
import { recommendModelsForVram, recommendSetupPath } from '../../shared/hardware-presets';
import { assessModelDownloadFit, type ModelDownloadFit } from '../../shared/model-download-fit';

type Step = 'welcome' | 'setup' | 'done';
const STEPS: Step[] = ['welcome', 'setup', 'done'];

type SetupPath = 'local' | 'cloud' | null;

// `signupUrl` is where a key is actually obtained. Without it this step asked
// for something the reader has never heard of and gave them nowhere to get it —
// the hardest stop in the app, on one of the two paths off the very first
// screen. SettingsPanel already links out this way in five places; the wizard,
// which is the one place a first-time user lands, was the exception.
//
// ORDER MATTERS: a first-time user reads this grid top-left to bottom-right and
// picks the first name they recognise. Every provider with a genuinely free
// tier therefore sits ABOVE every paid-only one — someone who has never heard
// of any of these should never land on "paid" before seeing that free exists.
const CLOUD_PROVIDERS: { id: CustomLLMConfig['provider']; name: string; freeHint?: string; signupUrl?: string }[] = [
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
  deepseek: 'deepseek-chat',
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

const ESSENTIAL_MODELS = [
  { name: 'qwen2.5:7b', desc: 'Chat model', sizeHint: '4.7 GB', sizeGB: 4.7 },
  { name: 'nomic-embed-text', desc: 'Embeddings for RAG', sizeHint: '274 MB', sizeGB: 0.3 },
];

type LocalSetupPhase =
  | 'checking'
  | 'ollama-missing'
  | 'downloading-ollama'
  | 'starting-ollama'
  | 'checking-models'
  | 'pulling-models'
  | 'ready';

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
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
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
  const [modelPullIndex, setModelPullIndex] = useState(0);
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
  const pullCancelledRef = useRef(false);
  const gpuInfoRef = useRef<{ vramGB: number | null; gpuName: string | null } | null>(null);
  const freeDiskGBRef = useRef<number | null>(null);

  // Cloud path state
  const [cloudProvider, setCloudProvider] = useState<CustomLLMConfig['provider']>('groq');
  const selectedCloudProvider = CLOUD_PROVIDERS.find(p => p.id === cloudProvider);
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  // What the "done" step is allowed to claim. Cloud counts only when the key
  // actually tested OK; local counts only when the local AI came up.
  const setupComplete =
    (setupPath === 'cloud' && cloudOk === true) ||
    (setupPath === 'local' && localPhase === 'ready');
  const [cloudModel, setCloudModel] = useState('');

  useEffect(() => { setDraft(settings); }, [settings]);

  // Subscribe to pull progress events
  useEffect(() => {
    const unsub = (window as any).electron.onPullModelProgress?.((data: ModelPullProgress) => {
      setModelPullProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  // Subscribe to Ollama download progress events
  useEffect(() => {
    const unsub = (window as any).electron.onOllamaDownloadProgress?.((data: OllamaDownloadProgress) => {
      setDownloadProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  const detectHardware = useCallback(async () => {
    try {
      const res = await (window as any).electron.detectGpuVram?.();
      if (res?.success) {
        setGpuInfo({ vramGB: res.vramGB, gpuName: res.gpuName });
        gpuInfoRef.current = { vramGB: res.vramGB, gpuName: res.gpuName };
        if (res.vramGB) {
          const profile = res.vramGB >= 12 ? '16gb+' : res.vramGB >= 6 ? '8gb' : '4gb';
          setDraft(d => ({ ...d, hardwareProfile: profile as any }));
        }
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

  const checkModelsAndPull = useCallback(async () => {
    setLocalPhase('checking-models');
    try {
      const modelList = await (window as any).electron.listOllamaModels?.();
      const installed: string[] = (modelList?.models || []).map((m: any) => m.name || m);
      setModels(installed);

      // Pick a chat model that fits the detected GPU instead of a fixed default.
      // Falls back to the balanced default (qwen2.5:7b) when VRAM is unknown.
      const rec = recommendModelsForVram(gpuInfoRef.current?.vramGB ?? null);
      const essentialModels = [
        { name: rec.chat.id, desc: 'Chat model', sizeHint: `~${rec.chat.sizeGB} GB`, sizeGB: rec.chat.sizeGB },
        ...ESSENTIAL_MODELS.filter(m => m.name !== 'qwen2.5:7b'),
      ];

      const missing = essentialModels.filter(m => !installed.some(i => i.startsWith(m.name.split(':')[0])));
      if (missing.length === 0) {
        setLocalPhase('ready');
        return;
      }

      // Model-size-aware disk guard. The disk.ok check in runLocalSetup is a flat
      // threshold; this compares the *actual* recommended chat model size against
      // free disk space so we never kick off a multi-GB pull that can't finish.
      const freeGB = freeDiskGBRef.current;
      const chatFit = assessModelDownloadFit({ sizeGB: rec.chat.sizeGB, freeGB });
      setModelDiskFit(chatFit.severity === 'ok' ? null : chatFit);

      setLocalPhase('pulling-models');
      pullCancelledRef.current = false;
      const pulled: string[] = [];
      for (let i = 0; i < missing.length; i++) {
        if (pullCancelledRef.current) break;
        // Skip any model that definitively won't fit instead of starting a doomed
        // download. unknown/tight/ok all proceed (the guard fails open).
        const fit = assessModelDownloadFit({ sizeGB: missing[i].sizeGB, freeGB });
        if (!fit.fits) {
          console.warn('Skipping model pull \u2014 insufficient disk:', missing[i].name, fit.message);
          continue;
        }
        setModelPullIndex(i);
        setModelPullProgress({ model: missing[i].name, status: 'starting pull...', percent: 0, completedMB: null, totalMB: null });
        try {
          await (window as any).electron.pullModelStream?.(missing[i].name);
          pulled.push(missing[i].name);
          setModelsPulled([...pulled]);
        } catch (e: any) {
          console.warn('Model pull failed:', missing[i].name, e);
        }
      }
      setModelPullProgress(null);

      const updatedList = await (window as any).electron.listOllamaModels?.();
      setModels((updatedList?.models || []).map((m: any) => m.name || m));
      setLocalPhase('ready');
    } catch {
      setLocalPhase('ready');
    }
  }, []);

  const runLocalSetup = useCallback(async () => {
    setLocalPhase('checking');
    setOllamaError(null);
    setDiskWarning(null);
    setDiskOk(true);
    setModelDiskFit(null);
    detectHardware();

    // E2E: skip the real Ollama detection. With no Ollama present,
    // checkConnection / checkOllamaInstalled / startOllama each run their full
    // network/spawn timeouts, which left the footer button stuck on "Setting
    // up…" well past the test's click timeout and flaked the first-run specs.
    // Jump straight to a deterministic terminal phase so "Continue anyway" is
    // immediately available. (diskOk stays true from above so the button isn't
    // gated on disk.)
    try {
      const env = await (window as any).electron?.getEnv?.();
      if (env?.isE2E) {
        setLocalPhase('ollama-missing');
        return;
      }
    } catch { /* fall through to real detection */ }

    // Check disk space before potentially pulling large models
    try {
      const diagResult = await (window as any).electron.runDiagnostics?.();
      if (diagResult?.disk) {
        setDiskOk(diagResult.disk.ok);
        setDiskWarning(diagResult.disk.warning ?? null);
        freeDiskGBRef.current =
          typeof diagResult.disk.freeGB === 'number' ? diagResult.disk.freeGB : null;
      }
    } catch { /* non-critical — don't block setup */ }

    // 1. Check if Ollama is running
    try {
      const status = await (window as any).electron.checkConnection?.();
      if (status?.ollama === 'online') {
        await checkModelsAndPull();
        return;
      }
    } catch { /* not running */ }

    // 2. Check if Ollama is installed
    const installCheck = await (window as any).electron.checkOllamaInstalled?.();
    if (installCheck?.installed) {
      // Installed but not running — start it
      setLocalPhase('starting-ollama');
      try {
        const startRes = await (window as any).electron.startOllama?.();
        if (startRes?.success) {
          await checkModelsAndPull();
          return;
        }
        setOllamaError(startRes?.error || 'Could not start Ollama');
        setLocalPhase('ollama-missing');
      } catch (e: any) {
        setOllamaError(e?.message || 'Failed to start Ollama');
        setLocalPhase('ollama-missing');
      }
      return;
    }

    // 3. Not installed
    setLocalPhase('ollama-missing');
  }, [detectHardware, checkModelsAndPull]);

  const handleDownloadOllama = async () => {
    setLocalPhase('downloading-ollama');
    setOllamaError(null);
    setDownloadProgress({ stage: 'downloading', percent: 0 });
    try {
      const res = await (window as any).electron.downloadOllama?.();
      if (res?.success) {
        await checkModelsAndPull();
      } else {
        setOllamaError(res?.error || 'Installation failed');
        setLocalPhase('ollama-missing');
      }
    } catch (e: any) {
      setOllamaError(e?.message || 'Download failed');
      setLocalPhase('ollama-missing');
    }
    setDownloadProgress(null);
  };

  const testCloudConnection = async () => {
    if (!cloudApiKey.trim()) return;
    setCloudTesting(true);
    setCloudOk(null);
    setCloudModel('');
    try {
      const apiUrl = PROVIDER_URLS[cloudProvider] || '';
      const res = await (window as any).electron.listCustomLLMModels?.({
        apiUrl,
        apiKey: cloudApiKey.trim(),
        provider: cloudProvider
      });
      const ok = res?.success && res.models?.length > 0;
      setCloudOk(ok);
      if (ok && res.models?.[0]?.id) {
        setCloudModel(res.models[0].id);
      }
    } catch {
      setCloudOk(false);
    } finally {
      setCloudTesting(false);
    }
  };

  const enterSetupStep = (path: SetupPath) => {
    setSetupPath(path);
    setStep('setup');
    if (path === 'local') {
      runLocalSetup();
    }
  };

  const handleFinish = async () => {
    const payload: any = { ...draft, firstRun: false, telemetryEnabled: telemetryConsent };
    if (telemetryConsent) payload.telemetryConsentTimestamp = new Date().toISOString();

    if (setupPath === 'cloud' && cloudApiKey.trim()) {
      const apiUrl = PROVIDER_URLS[cloudProvider] || '';
      const model = cloudModel || PROVIDER_DEFAULT_MODELS[cloudProvider] || '';
      payload.useCustomLLM = true;
      payload.customLLM = {
        name: CLOUD_PROVIDERS.find(p => p.id === cloudProvider)?.name || 'Cloud LLM',
        apiUrl,
        apiKey: cloudApiKey.trim(),
        provider: cloudProvider,
        model,
        enabled: true
      };
      if (cloudProvider === 'anthropic') payload.anthropicApiKey = cloudApiKey.trim();
      else if (cloudProvider === 'openai') payload.openaiApiKey = cloudApiKey.trim();
      else if (cloudProvider === 'google-ai-studio' || cloudProvider === 'google-gemini') payload.geminiApiKey = cloudApiKey.trim();
    }

    try { await (window as any).electron.saveSettings?.(payload); } catch (e) { console.warn('FirstRun save failed:', e); }
    onSave(payload);
    onClose();
  };

  const handleSkip = async () => {
    const payload = { ...draft, firstRun: false, telemetryEnabled: false } as any;
    try { await (window as any).electron.saveSettings?.(payload); } catch (e) { console.warn('FirstRun skip save failed:', e); }
    onSave(payload);
    onClose();
  };

  if (!open) return null;

  const stepIndex = STEPS.indexOf(step);
  const localBusy = localPhase === 'checking' || localPhase === 'downloading-ollama' || localPhase === 'starting-ollama' || localPhase === 'pulling-models';

  return (
    <div className="first-run-overlay">
      <div className="first-run-modal">
        {/* Progress dots */}
        <div className="wizard-progress">
          {STEPS.map((s, i) => (
            <div key={s} className={`wizard-dot${i <= stepIndex ? ' active' : ''}${s === step ? ' current' : ''}`} />
          ))}
        </div>

        <div className="first-run-content">
          {step === 'welcome' && (
            <div className="wizard-step">
              <div className="wizard-icon">✨</div>
              <h1 className="first-run-title">Welcome to HomeBot</h1>
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
                    Private — nothing leaves your computer. Free forever, no account needed.
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
                    Faster and smarter, works on any computer. Several providers have genuinely free tiers — no card needed.
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
              <h2 className="wizard-step-title">Local Setup</h2>

              {/* GPU info */}
              {gpuInfo && gpuInfo.vramGB && (
                <div className="wizard-status success wizard-gpu-info">
                  Detected: {gpuInfo.gpuName || 'GPU'} ({gpuInfo.vramGB.toFixed(1)} GB VRAM)
                </div>
              )}

              {/* Phase: Checking */}
              {localPhase === 'checking' && (
                <div className="wizard-status checking">
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
                    <button type="button" className="first-run-btn first-run-btn-primary" onClick={handleDownloadOllama}>
                      Install Ollama automatically
                    </button>
                    <button type="button" className="first-run-btn first-run-btn-secondary" onClick={runLocalSetup}>
                      Retry
                    </button>
                  </div>
                  <p className="wizard-step-desc wizard-install-hint">
                    Or <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">install manually</a>, then click Retry.
                  </p>
                </div>
              )}

              {/* Phase: Downloading Ollama */}
              {localPhase === 'downloading-ollama' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status checking">
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
                <div className="wizard-status checking">
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
                  {modelDiskFit.severity === 'insufficient' && ' The chat model download was skipped.'}
                </div>
              )}

              {/* Phase: Checking models */}
              {localPhase === 'checking-models' && (
                <div className="wizard-status checking">
                  <span className="wizard-spinner" />Checking installed models...
                </div>
              )}

              {/* Phase: Pulling models */}
              {localPhase === 'pulling-models' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status checking">
                    <span className="wizard-spinner" />
                    Downloading AI models ({modelPullIndex + 1} of {ESSENTIAL_MODELS.length})
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
              {localPhase === 'ready' && (
                <div className="wizard-setup-section">
                  <div className="wizard-status success">Ollama is ready!</div>
                  {models.length > 0 && (
                    <div className="wizard-model-compact">
                      <p className="wizard-step-desc">
                        {models.length} model{models.length > 1 ? 's' : ''} installed. Using: <strong>{draft.chatModel || models[0]}</strong>
                      </p>
                      {models.length > 1 && (
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
              <h2 className="wizard-step-title">Connect an AI service</h2>
              <p className="wizard-step-desc">
                These companies run the AI for you. Pick one, make a free account, and it
                gives you a long password called a key — paste that below. The ones marked
                “free” don’t ask for a card.
              </p>

              <div className="wizard-cloud-provider-grid">
                {CLOUD_PROVIDERS.map(p => (
                  <button
                    type="button"
                    key={p.id}
                    className={`wizard-cloud-chip${cloudProvider === p.id ? ' selected' : ''}`}
                    onClick={() => { setCloudProvider(p.id); setCloudOk(null); setCloudModel(''); }}
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

              <input
                type="password"
                className="first-run-input"
                placeholder="Paste the key from your account page"
                value={cloudApiKey}
                onChange={e => { setCloudApiKey(e.target.value); setCloudOk(null); setCloudModel(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && cloudApiKey.trim()) testCloudConnection(); }}
                autoComplete="off"
              />

              <div className="wizard-btn-row wizard-test-row">
                <button
                  type="button"
                  className="first-run-btn first-run-btn-primary"
                  onClick={testCloudConnection}
                  disabled={cloudTesting || !cloudApiKey.trim()}
                >
                  {cloudTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {cloudOk === true && (
                <div className="wizard-status success">Connected! Ready to chat.</div>
              )}
              {cloudOk === false && (
                <div className="wizard-status error">Connection failed. Check your API key and try again.</div>
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
              <div className="wizard-icon">{setupComplete ? '🎉' : '👋'}</div>
              <h2 className="wizard-step-title">
                {setupComplete ? "You're all set!" : 'Ready when you are'}
              </h2>
              <p className="wizard-step-desc">
                {setupComplete
                  ? 'Try asking HomeBot anything — check the weather, search the web, read files, or just chat.'
                  : 'Nothing was set up yet — that’s fine. HomeBot will use whatever it can find on this PC, and you can finish setting up any time from Settings.'}
              </p>
              <div className="wizard-suggestions">
                <span className="wizard-suggestion-chip">What's the weather?</span>
                <span className="wizard-suggestion-chip">Summarize my clipboard</span>
                <span className="wizard-suggestion-chip">What's in the news?</span>
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
          <button type="button" onClick={handleSkip} className="first-run-btn first-run-btn-secondary">Skip setup</button>
          <div className="wizard-nav-btns">
            {step === 'setup' && (
              <button type="button" onClick={() => { setStep('welcome'); setSetupPath(null); pullCancelledRef.current = true; }} className="first-run-btn first-run-btn-secondary">Back</button>
            )}
            {step === 'setup' && (
              <button
                type="button"
                onClick={() => setStep('done')}
                className="first-run-btn first-run-btn-primary"
                disabled={(setupPath === 'local' && (localBusy || !diskOk)) || (setupPath === 'cloud' && cloudOk !== true && cloudApiKey.trim().length > 0)}
              >
                {setupPath === 'local' && !diskOk ? 'Free up disk space first' : setupPath === 'local' && localPhase === 'ready' ? 'Next' : setupPath === 'local' && localBusy ? 'Setting up...' : setupPath === 'local' ? 'Continue anyway' : 'Next'}
              </button>
            )}
            {step === 'done' && (
              <button type="button" onClick={handleFinish} className="first-run-btn first-run-btn-primary">Get Started</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
