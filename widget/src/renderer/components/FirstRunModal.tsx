import { useEffect, useState } from 'react';
import type { Settings, CustomLLMConfig } from '../../shared/types';

type Step = 'welcome' | 'setup' | 'done';
const STEPS: Step[] = ['welcome', 'setup', 'done'];

type SetupPath = 'local' | 'cloud' | null;

const CLOUD_PROVIDERS: { id: CustomLLMConfig['provider']; name: string; freeHint?: string }[] = [
  { id: 'groq', name: 'Groq', freeHint: 'Free tier available' },
  { id: 'openrouter', name: 'OpenRouter', freeHint: 'Free models available' },
  { id: 'google-ai-studio', name: 'Google AI Studio', freeHint: 'Free tier' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'cerebras', name: 'Cerebras', freeHint: 'Free tier' },
  { id: 'sambanova', name: 'SambaNova', freeHint: 'Free tier' },
  { id: 'together', name: 'Together AI' },
  { id: 'huggingface', name: 'Hugging Face', freeHint: 'Free inference' },
];

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  openrouter: 'openai/gpt-4o-mini',
  groq: 'llama-3.3-70b-versatile',
  deepseek: 'deepseek-chat',
  'google-ai-studio': 'gemini-2.5-flash',
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
  huggingface: 'https://api-inference.huggingface.co/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  together: 'https://api.together.xyz/v1',
};

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
  const [setupPath, setSetupPath] = useState<SetupPath>(null);

  // Local path state
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [ollamaStarting, setOllamaStarting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [gpuInfo, setGpuInfo] = useState<{ vramGB: number | null; gpuName: string | null } | null>(null);

  // Cloud path state
  const [cloudProvider, setCloudProvider] = useState<CustomLLMConfig['provider']>('groq');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [cloudModel, setCloudModel] = useState('');

  useEffect(() => { setDraft(settings); }, [settings]);

  if (!open) return null;

  const stepIndex = STEPS.indexOf(step);

  const checkOllama = async () => {
    setOllamaChecking(true);
    try {
      const status = await (window as any).electron.checkConnection?.();
      const online = status?.ollama === 'online';
      setOllamaOk(online);
      if (online) {
        const modelList = await (window as any).electron.listOllamaModels?.();
        if (modelList?.success && modelList.models) {
          setModels(modelList.models.map((m: any) => m.name || m));
        }
      }
    } catch {
      setOllamaOk(false);
    } finally {
      setOllamaChecking(false);
    }
  };

  const startOllama = async () => {
    setOllamaStarting(true);
    try {
      const res = await (window as any).electron.startOllama?.();
      if (res?.success || res?.alreadyRunning) {
        await checkOllama();
      } else {
        setOllamaOk(false);
      }
    } catch {
      setOllamaOk(false);
    } finally {
      setOllamaStarting(false);
    }
  };

  const detectHardware = async () => {
    try {
      const res = await (window as any).electron.detectGpuVram?.();
      if (res?.success) {
        setGpuInfo({ vramGB: res.vramGB, gpuName: res.gpuName });
        if (res.vramGB) {
          const profile = res.vramGB >= 12 ? '16gb+' : res.vramGB >= 6 ? '8gb' : '4gb';
          setDraft(d => ({ ...d, hardwareProfile: profile as any }));
        }
      }
    } catch { /* non-critical */ }
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
      checkOllama();
      detectHardware();
    }
  };

  const handleFinish = async () => {
    const payload: any = { ...draft, firstRun: false, telemetryEnabled: true, telemetryConsentTimestamp: new Date().toISOString() };

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
    }

    try { await (window as any).electron.saveSettings?.(payload); } catch (e) { console.warn('FirstRun save failed:', e); }
    onSave(payload);
    onClose();
  };

  const handleSkip = async () => {
    const payload = { ...draft, firstRun: false, telemetryEnabled: true, telemetryConsentTimestamp: new Date().toISOString() } as any;
    try { await (window as any).electron.saveSettings?.(payload); } catch (e) { console.warn('FirstRun skip save failed:', e); }
    onSave(payload);
    onClose();
  };

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
              <h1 className="first-run-title">Welcome to SADIE</h1>
              <p className="first-run-subtitle">
                Your private AI desktop assistant. Choose how you'd like to power the AI:
              </p>
              <div className="wizard-path-cards">
                <button
                  type="button"
                  className={`wizard-path-card${setupPath === 'local' ? ' selected' : ''}`}
                  onClick={() => enterSetupStep('local')}
                >
                  <span className="wizard-path-icon">🖥️</span>
                  <strong>Local (Ollama)</strong>
                  <span className="wizard-path-desc">100% private, runs on your GPU. Free forever.</span>
                </button>
                <button
                  type="button"
                  className={`wizard-path-card${setupPath === 'cloud' ? ' selected' : ''}`}
                  onClick={() => enterSetupStep('cloud')}
                >
                  <span className="wizard-path-icon">☁️</span>
                  <strong>Cloud API</strong>
                  <span className="wizard-path-desc">Instant setup. GPT-4o, Claude, Gemini, free tiers available.</span>
                </button>
              </div>
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

              {/* Ollama status */}
              {ollamaChecking ? (
                <div className="wizard-status checking">Checking Ollama...</div>
              ) : ollamaOk === true ? (
                <>
                  <div className="wizard-status success">Ollama is running!</div>
                  {models.length > 0 ? (
                    <div className="wizard-model-compact">
                      <p className="wizard-step-desc">
                        Found {models.length} model{models.length > 1 ? 's' : ''}. Using: <strong>{draft.chatModel || models[0]}</strong>
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
                  ) : (
                    <div className="wizard-status info">
                      <p>No models installed yet. SADIE will pull one for you on first chat, or run:</p>
                      <code>ollama pull qwen2.5:7b</code>
                    </div>
                  )}
                </>
              ) : ollamaOk === false ? (
                <div className="wizard-status error">
                  <p>Ollama not detected.</p>
                  <div className="wizard-btn-row">
                    <button
                      type="button"
                      className="first-run-btn first-run-btn-primary"
                      onClick={startOllama}
                      disabled={ollamaStarting}
                    >
                      {ollamaStarting ? 'Starting...' : 'Start Ollama'}
                    </button>
                    <button type="button" className="first-run-btn first-run-btn-secondary" onClick={checkOllama}>Retry</button>
                  </div>
                  <p className="wizard-step-desc wizard-install-hint">
                    Or <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">install Ollama</a> first, then retry.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {step === 'setup' && setupPath === 'cloud' && (
            <div className="wizard-step">
              <h2 className="wizard-step-title">Cloud Setup</h2>
              <p className="wizard-step-desc">Pick a provider and paste your API key. Free tiers are marked.</p>

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

              <input
                type="password"
                className="first-run-input"
                placeholder="Paste your API key"
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
              <div className="wizard-icon">🎉</div>
              <h2 className="wizard-step-title">You're all set!</h2>
              <p className="wizard-step-desc">
                Try asking SADIE anything — check the weather, search the web, read files, or just chat.
              </p>
              <div className="wizard-suggestions">
                <span className="wizard-suggestion-chip">What's the weather?</span>
                <span className="wizard-suggestion-chip">Summarize my clipboard</span>
                <span className="wizard-suggestion-chip">What's in the news?</span>
              </div>
            </div>
          )}
        </div>

        <div className="first-run-footer">
          <button type="button" onClick={handleSkip} className="first-run-btn first-run-btn-secondary">Skip setup</button>
          <div className="wizard-nav-btns">
            {step === 'setup' && (
              <button type="button" onClick={() => { setStep('welcome'); setSetupPath(null); }} className="first-run-btn first-run-btn-secondary">Back</button>
            )}
            {step === 'setup' && (
              <button
                type="button"
                onClick={() => setStep('done')}
                className="first-run-btn first-run-btn-primary"
                disabled={setupPath === 'cloud' && cloudOk !== true && cloudApiKey.trim().length > 0}
              >
                {setupPath === 'local' && ollamaOk !== true ? 'Continue anyway' : 'Next'}
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
