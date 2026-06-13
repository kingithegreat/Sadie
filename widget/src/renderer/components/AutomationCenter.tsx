import React, { useState, useEffect, useCallback } from 'react';
import type { SavedAutomation } from '../../shared/types';

const EXAMPLE_AUTOMATIONS = [
  { name: 'Morning News Summary', instructions: 'Search for the top 5 tech news stories today, summarise each in one sentence, and save the summary to a file called tech-news.txt on my Desktop' },
  { name: 'Backup Documents', instructions: 'Create a zip archive of all .docx and .pdf files in my Documents folder and save it to my Desktop as documents-backup.zip' },
  { name: 'Project Status', instructions: 'Run git status and git log for the last 5 commits in the current directory, then summarise what changed recently' },
  { name: 'Weather Report', instructions: 'Search for the current weather in Tauranga, New Zealand and save the forecast to a file called weather.txt on my Desktop' },
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
      const result = await window.electron?.createAutomation?.({
        name: formName.trim(),
        description: formDesc.trim(),
        instructions: formInstructions.trim(),
        trigger: formTrigger,
        scheduleMinutes: formTrigger === 'schedule' ? formSchedule : undefined,
      });
      if (result?.automation) {
        setAutomations(prev => [...prev, result.automation]);
        setFormName('');
        setFormDesc('');
        setFormInstructions('');
        setFormTrigger('manual');
        setIsCreating(false);
      }
    } catch {
      setError('Failed to create automation');
    }
  }, [formName, formDesc, formInstructions, formTrigger, formSchedule]);

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
  }, []);

  return (
    <div className="automation-center">
      <header className="automation-header">
        <h1>Automation Center</h1>
        <p>Create reusable workflows that chain SADIE's tools together</p>
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
              placeholder="Tell SADIE what to do in plain English. It will use its tools (web search, file manager, code runner, etc.) to carry out the task."
              rows={4}
            />
            <span className="form-hint">This is the prompt SADIE will execute when you run this automation</span>
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
              disabled={!formName.trim() || !formInstructions.trim()}
            >
              Create Automation
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
            <p>Create your first automation to chain SADIE's tools into reusable workflows.</p>
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
