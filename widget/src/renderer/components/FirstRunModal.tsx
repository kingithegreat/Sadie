import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';

type Step = 'welcome' | 'connection' | 'model' | 'permissions' | 'done';
const STEPS: Step[] = ['welcome', 'connection', 'model', 'permissions', 'done'];

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
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => { setDraft(settings); }, [settings]);

  const PERMISSION_DESCRIPTIONS: Record<string, string> = {
    delete_file: 'Allows permanent deletion of files',
    move_file: 'Allows moving files between folders',
    launch_app: 'Allows launching installed applications',
    screenshot: 'Allows capture of screen contents',
  };

  if (!open) return null;

  const stepIndex = STEPS.indexOf(step);
  const canNext = stepIndex < STEPS.length - 1;
  const canBack = stepIndex > 0 && step !== 'done';

  const checkOllama = async () => {
    setChecking(true);
    try {
      const status = await (window as any).electron.checkConnection?.();
      setOllamaOk(status?.ollama === 'online');
      if (status?.ollama === 'online') {
        const modelList = await (window as any).electron.listOllamaModels?.();
        if (modelList?.success && modelList.models) {
          setModels(modelList.models.map((m: any) => m.name || m));
        }
      }
    } catch {
      setOllamaOk(false);
    } finally {
      setChecking(false);
    }
  };

  const goNext = () => {
    const next = STEPS[stepIndex + 1];
    if (next === 'connection') checkOllama();
    setStep(next);
  };

  const goBack = () => setStep(STEPS[stepIndex - 1]);

  const handleFinish = async () => {
    const payload = { ...draft, firstRun: false, telemetryEnabled: true, telemetryConsentTimestamp: new Date().toISOString() } as any;
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
                Your local AI desktop assistant. This quick setup will get you started in under a minute.
              </p>
              <ul className="wizard-checklist">
                <li>Check Ollama connection</li>
                <li>Choose your AI model</li>
                <li>Set permissions</li>
              </ul>
            </div>
          )}

          {step === 'connection' && (
            <div className="wizard-step">
              <h2 className="wizard-step-title">Connection Check</h2>
              <p className="wizard-step-desc">SADIE needs Ollama running locally to power the AI chat.</p>
              {checking ? (
                <div className="wizard-status checking">Checking connection...</div>
              ) : ollamaOk === true ? (
                <div className="wizard-status success">Ollama is running and ready!</div>
              ) : ollamaOk === false ? (
                <div className="wizard-status error">
                  <p>Ollama not detected. Please start Ollama and try again.</p>
                  <button className="first-run-btn first-run-btn-secondary" onClick={checkOllama}>Retry</button>
                </div>
              ) : null}
            </div>
          )}

          {step === 'model' && (
            <div className="wizard-step">
              <h2 className="wizard-step-title">Choose a Model</h2>
              <p className="wizard-step-desc">Pick the AI model SADIE will use for chat. You can change this later in Settings.</p>
              {models.length > 0 ? (
                <div className="wizard-model-list">
                  {models.map(m => (
                    <label key={m} className={`wizard-model-option${draft.chatModel === m ? ' selected' : ''}`}>
                      <input
                        type="radio"
                        name="chatModel"
                        checked={draft.chatModel === m}
                        onChange={() => setDraft({ ...draft, chatModel: m })}
                      />
                      <span>{m}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="wizard-status info">
                  <p>No models found. Install one with: <code>ollama pull qwen2.5:7b</code></p>
                  <input
                    type="text"
                    className="first-run-input"
                    value={draft.chatModel || ''}
                    onChange={e => setDraft({ ...draft, chatModel: e.target.value })}
                    placeholder="Enter model name manually"
                  />
                </div>
              )}
            </div>
          )}

          {step === 'permissions' && (
            <div className="wizard-step">
              <h2 className="wizard-step-title">Permissions</h2>
              <p className="wizard-step-desc">Enable tools SADIE can use. Dangerous operations are off by default.</p>
              <div className="permissions-container">
                {(Object.keys(draft.permissions || {}) as string[]).map(k => (
                  <div key={k} className="permission-item">
                    <label className="first-run-checkbox">
                      <input
                        type="checkbox"
                        checked={!!draft.permissions?.[k]}
                        onChange={e => setDraft({
                          ...draft,
                          permissions: { ...(draft.permissions || {}), [k]: e.target.checked }
                        })}
                      />
                      <span className="first-run-checkbox-text capitalize">{k.replace(/_/g, ' ')}</span>
                    </label>
                    {PERMISSION_DESCRIPTIONS[k] && (
                      <small className="permission-warning">{PERMISSION_DESCRIPTIONS[k]}</small>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="wizard-step">
              <div className="wizard-icon">🎉</div>
              <h2 className="wizard-step-title">You're all set!</h2>
              <p className="wizard-step-desc">
                SADIE is ready to help. Try asking a question, creating a file, or checking the weather.
              </p>
            </div>
          )}
        </div>

        <div className="first-run-footer">
          <button onClick={handleSkip} className="first-run-btn first-run-btn-secondary">Skip setup</button>
          <div className="wizard-nav-btns">
            {canBack && <button onClick={goBack} className="first-run-btn first-run-btn-secondary">Back</button>}
            {canNext && <button onClick={goNext} className="first-run-btn first-run-btn-primary">Next</button>}
            {step === 'done' && <button onClick={handleFinish} className="first-run-btn first-run-btn-primary">Get Started</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
