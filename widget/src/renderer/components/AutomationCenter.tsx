import React, { useState, useEffect, useCallback } from 'react';
import type { SavedAutomation } from '../../shared/types';

const EXAMPLE_AUTOMATIONS = [
  { name: 'Morning News Summary', instructions: 'Search for the top 5 tech news stories today, summarise each in one sentence, and save the summary to a file called tech-news.txt on my Desktop' },
  { name: 'Backup Documents', instructions: 'Create a zip archive of all .docx and .pdf files in my Documents folder and save it to my Desktop as documents-backup.zip' },
  { name: 'Project Status', instructions: 'Run git status and git log for the last 5 commits in the current directory, then summarise what changed recently' },
  { name: 'Weather Report', instructions: 'Search for the current weather in Tauranga, New Zealand and save the forecast to a file called weather.txt on my Desktop' },
];

interface AutomationTemplate {
  icon: string;
  name: string;
  description: string;
  instructions: string;
  trigger: 'manual' | 'schedule';
  scheduleMinutes?: number;
}

const TEMPLATE_AUTOMATIONS: AutomationTemplate[] = [
  {
    icon: '\u{2600}',
    name: 'Daily Digest',
    description: 'Morning briefing with motivational quote and productivity tip',
    instructions: 'Generate a morning digest: a warm greeting for the time of day, a motivational quote, a productivity tip, and a suggested focus area. Format with markdown headers.',
    trigger: 'schedule',
    scheduleMinutes: 1440,
  },
  {
    icon: '\u{1F50D}',
    name: 'Web Research',
    description: 'Research any topic with structured analysis',
    instructions: 'Research the topic I provide. Include key points as bullet points, a detailed analysis paragraph, and suggest sources for further reading. Be factual and thorough.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F4E7}',
    name: 'Email Drafter',
    description: 'Draft professional emails from context',
    instructions: 'Draft a professional email based on the context I give. Include a clear subject line, keep paragraphs short, and end with an appropriate sign-off. Suggest 2-3 sign-off options.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F4DA}',
    name: 'Study Flashcards',
    description: 'Generate study flashcards for any topic',
    instructions: 'Generate 10 study flashcards for the topic I provide. Each card should have a clear question and concise answer. Mix definitions, concepts, and applications. Format each as Card N with Q: and A: labels.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F4BB}',
    name: 'Code Explainer',
    description: 'Break down code into clear explanations',
    instructions: 'Explain the code I paste. Identify the language, summarise its purpose, break down key sections, list programming concepts used, and suggest improvements. Be educational.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F5A5}',
    name: 'System Health Check',
    description: 'Check system resources and Ollama status',
    instructions: 'Check my system information including disk usage, memory, and running processes. Also check if Ollama is running and what models are installed. Report any issues.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F4CB}',
    name: 'Smart Standup',
    description: 'Daily standup with quote, focus areas, and checklist',
    instructions: 'Generate a daily standup briefing with: a greeting for the time of day, a motivational quote, 3 specific focus areas for a developer, a standup checklist, and a pro tip. Use markdown formatting and emojis.',
    trigger: 'schedule',
    scheduleMinutes: 1440,
  },
];

export const AutomationCenter: React.FC = () => {
  const [automations, setAutomations] = useState<SavedAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formInstructions, setFormInstructions] = useState('');
  const [formTrigger, setFormTrigger] = useState<'manual' | 'schedule'>('manual');
  const [formSchedule, setFormSchedule] = useState(60);
  const [formN8nUrl, setFormN8nUrl] = useState('');
  const [formUseN8n, setFormUseN8n] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electron?.loadAutomations?.();
      setAutomations(result?.automations || []);
    } catch {
      setError('Failed to load automations');
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAutomations(); }, [loadAutomations]);

  const handleCreate = useCallback(async () => {
    if (!formName.trim() || !formInstructions.trim()) return;
    try {
      if (formUseN8n) setDeploying(true);
      const result = await window.electron?.createAutomation?.({
        name: formName.trim(),
        description: formDesc.trim(),
        instructions: formInstructions.trim(),
        trigger: formTrigger,
        scheduleMinutes: formTrigger === 'schedule' ? formSchedule : undefined,
        n8nWebhookUrl: formN8nUrl.trim() || undefined,
        deployToN8n: formUseN8n,
      });
      if (result?.automation) {
        setAutomations(prev => [...prev, result.automation]);
        setFormName('');
        setFormDesc('');
        setFormInstructions('');
        setFormTrigger('manual');
        setFormN8nUrl('');
        setFormUseN8n(false);
        setIsCreating(false);
      }
      if (result?.error) setError(result.error);
    } catch {
      setError('Failed to create automation');
    } finally {
      setDeploying(false);
    }
  }, [formName, formDesc, formInstructions, formTrigger, formSchedule, formUseN8n, formN8nUrl]);

  const handleToggle = useCallback(async (id: string) => {
    const auto = automations.find(a => a.id === id);
    if (!auto) return;
    try {
      await window.electron?.updateAutomation?.({ id, enabled: !auto.enabled });
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
    } catch {
      setError('Failed to update automation');
    }
  }, [automations]);

  const handleRun = useCallback(async (id: string) => {
    setRunningId(id);
    setError(null);
    try {
      const result = await window.electron?.runAutomation?.({ id });
      // Update local state with result
      setAutomations(prev => prev.map(a => a.id === id ? {
        ...a,
        lastRun: new Date().toISOString(),
        lastResult: result?.result || result?.error || 'Done',
      } : a));
      setExpandedId(id);
    } catch {
      setError('Failed to run automation');
    } finally {
      setRunningId(null);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await window.electron?.deleteAutomation?.({ id });
      setAutomations(prev => prev.filter(a => a.id !== id));
    } catch {
      setError('Failed to delete automation');
    }
  }, []);

  const applyExample = useCallback((ex: typeof EXAMPLE_AUTOMATIONS[0]) => {
    setFormName(ex.name);
    setFormInstructions(ex.instructions);
    setFormDesc('');
    setFormTrigger('manual');
    setFormN8nUrl('');
  }, []);

  const applyTemplate = useCallback((tpl: AutomationTemplate) => {
    setFormName(tpl.name);
    setFormDesc(tpl.description);
    setFormInstructions(tpl.instructions);
    setFormTrigger(tpl.trigger);
    if (tpl.scheduleMinutes) setFormSchedule(tpl.scheduleMinutes);
    setFormN8nUrl('');
    setFormUseN8n(false);
  }, []);

  return (
    <div className="automation-center">
      <header className="automation-header">
        <h1>Automation Center</h1>
        <p>Create reusable workflows that chain HomeBot's tools together</p>
      </header>

      {error && (
        <div className="automation-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
        </div>
      )}

      <div className="automation-actions">
        <button
          className="btn-primary"
          onClick={() => setIsCreating(!isCreating)}
        >
          {isCreating ? '✕ Cancel' : '+ New Automation'}
        </button>
        <button
          className="btn-secondary"
          onClick={loadAutomations}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {isCreating && (
        <div className="automation-create-form">
          <h3>Create New Automation</h3>

          {/* Pre-built Templates */}
          <div className="template-section">
            <p className="template-section-label">Start from a template:</p>
            <div className="template-grid">
              {TEMPLATE_AUTOMATIONS.map(tpl => (
                <button
                  key={tpl.name}
                  type="button"
                  className="template-card"
                  onClick={() => applyTemplate(tpl)}
                >
                  <span className="template-card-icon">{tpl.icon}</span>
                  <span>
                    <span className="template-card-name">{tpl.name}</span>
                    <span className="template-card-desc">{tpl.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="auto-name">Name</label>
            <input
              id="auto-name"
              type="text"
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder="e.g. Morning News Summary"
            />
          </div>

          <div className="form-group">
            <label htmlFor="auto-instructions">Instructions</label>
            <textarea
              id="auto-instructions"
              value={formInstructions}
              onChange={e => setFormInstructions(e.target.value)}
              placeholder="Tell HomeBot what to do in plain English. It will use its tools (web search, file manager, code runner, etc.) to carry out the task."
              rows={4}
            />
            <span className="form-hint">This is the prompt HomeBot will execute when you run this automation</span>
          </div>

          <div className="form-group">
            <label htmlFor="auto-desc">Description (optional)</label>
            <input
              id="auto-desc"
              type="text"
              value={formDesc}
              onChange={e => setFormDesc(e.target.value)}
              placeholder="Short description of what this does"
            />
          </div>

          <div className="form-group">
            <label htmlFor="auto-trigger">Trigger</label>
            <select
              id="auto-trigger"
              value={formTrigger}
              onChange={e => setFormTrigger(e.target.value as 'manual' | 'schedule')}
            >
              <option value="manual">Manual (run on demand)</option>
              <option value="schedule">Scheduled</option>
            </select>
          </div>

          {formTrigger === 'schedule' && (
            <div className="form-group">
              <label htmlFor="auto-schedule">Run every</label>
              <select
                id="auto-schedule"
                value={formSchedule}
                onChange={e => setFormSchedule(Number(e.target.value))}
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={360}>6 hours</option>
                <option value={720}>12 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={formUseN8n}
                onChange={e => { setFormUseN8n(e.target.checked); if (!e.target.checked) setFormN8nUrl(''); }}
              />
              <span>Deploy to n8n</span>
            </label>
            <span className="form-hint">
              {formUseN8n
                ? 'HomeBot will create an n8n workflow automatically and run this automation through it.'
                : 'Runs using HomeBot\'s local AI tools (no n8n required).'}
            </span>
          </div>

          {formUseN8n && (
            <div className="form-group">
              <label htmlFor="auto-n8n-url">Custom Webhook URL (optional)</label>
              <input
                id="auto-n8n-url"
                type="text"
                value={formN8nUrl}
                onChange={e => setFormN8nUrl(e.target.value)}
                placeholder="Leave blank to auto-generate, or paste an existing n8n webhook URL"
              />
            </div>
          )}

          {/* Example templates */}
          <div className="automation-examples">
            <span className="form-hint">Try an example:</span>
            <div className="example-chips">
              {EXAMPLE_AUTOMATIONS.map(ex => (
                <button key={ex.name} className="example-chip" onClick={() => applyExample(ex)} type="button">
                  {ex.name}
                </button>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={!formName.trim() || !formInstructions.trim() || deploying}
            >
              {deploying ? 'Deploying to n8n...' : formUseN8n ? 'Create & Deploy to n8n' : 'Create Automation'}
            </button>
            <button className="btn-secondary" onClick={() => setIsCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="automation-list">
        {loading ? (
          <div className="automation-loading">Loading automations...</div>
        ) : automations.length === 0 ? (
          <div className="automation-empty">
            <p>No automations yet.</p>
            <p>Create your first automation to chain HomeBot's tools into reusable workflows.</p>
          </div>
        ) : (
          automations.map(auto => (
            <div key={auto.id} className={`automation-card ${auto.enabled ? 'enabled' : 'disabled'} ${runningId === auto.id ? 'running' : ''}`}>
              <div className="automation-info">
                <div className="automation-title-row">
                  <h3>{auto.name}</h3>
                  <div className="automation-badges">
                    <span className="trigger-badge">{auto.trigger}</span>
                    {auto.trigger === 'schedule' && auto.scheduleMinutes && (
                      <span className="schedule-badge">every {auto.scheduleMinutes >= 60 ? `${auto.scheduleMinutes / 60}h` : `${auto.scheduleMinutes}m`}</span>
                    )}
                    {auto.n8nWebhookUrl && (
                      <span className="schedule-badge" title={auto.n8nWebhookUrl}>n8n</span>
                    )}
                  </div>
                </div>
                {auto.description && <p className="automation-desc">{auto.description}</p>}
                <p className="automation-instructions">{auto.instructions}</p>
                {auto.lastRun && (
                  <div className="automation-meta">
                    <span className="last-run">Last run: {new Date(auto.lastRun).toLocaleString()}</span>
                  </div>
                )}
                {/* Expandable last result */}
                {auto.lastResult && (
                  <div className="automation-result-section">
                    <button
                      className="result-toggle"
                      onClick={() => setExpandedId(expandedId === auto.id ? null : auto.id)}
                      type="button"
                    >
                      {expandedId === auto.id ? '▾ Hide result' : '▸ Show last result'}
                    </button>
                    {expandedId === auto.id && (
                      <pre className="automation-result">{auto.lastResult}</pre>
                    )}
                  </div>
                )}
              </div>
              <div className="automation-controls">
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${auto.name}`}
                    checked={auto.enabled}
                    onChange={() => handleToggle(auto.id)}
                  />
                  <span className="slider"></span>
                </label>
                <button
                  className="btn-icon"
                  onClick={() => handleRun(auto.id)}
                  title="Run now"
                  aria-label={`Run ${auto.name}`}
                  disabled={runningId !== null}
                >
                  {runningId === auto.id ? '⏳' : '▶'}
                </button>
                <button
                  className="btn-icon btn-danger"
                  onClick={() => handleDelete(auto.id)}
                  title="Delete"
                  aria-label={`Delete ${auto.name}`}
                  disabled={runningId === auto.id}
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AutomationCenter;
