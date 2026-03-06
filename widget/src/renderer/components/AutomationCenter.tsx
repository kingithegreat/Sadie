import React, { useState, useEffect } from 'react';

interface Automation {
  id: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  lastRun?: string;
}

interface AutomationCenterProps {}

export const AutomationCenter: React.FC<AutomationCenterProps> = () => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newAutomation, setNewAutomation] = useState({ name: '', description: '', trigger: 'manual' });
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadAutomations();
  }, []);

  const loadAutomations = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load automations from backend
      const result = await (window as any).electron?.loadAutomations?.();
      if (result?.automations) {
        setAutomations(result.automations);
      } else {
        // Default empty state
        setAutomations([]);
      }
    } catch (err) {
      setError('Failed to load automations');
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleAutomation = async (id: string) => {
    const automation = automations.find(a => a.id === id);
    if (!automation) return;

    try {
      await (window as any).electron?.updateAutomation?.({
        id,
        enabled: !automation.enabled
      });
      setAutomations(prev => 
        prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a)
      );
    } catch (err) {
      setError('Failed to update automation');
    }
  };

  const runAutomation = async (id: string) => {
    try {
      await (window as any).electron?.runAutomation?.({ id });
      // Refresh to get updated lastRun
      loadAutomations();
    } catch (err) {
      setError('Failed to run automation');
    }
  };

  const deleteAutomation = async (id: string) => {
    try {
      await (window as any).electron?.deleteAutomation?.({ id });
      setAutomations(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      setError('Failed to delete automation');
    }
  };

  const handleCreateAutomation = async () => {
    if (!newAutomation.name.trim()) return;

    try {
      const result = await (window as any).electron?.createAutomation?.({
        name: newAutomation.name,
        description: newAutomation.description,
        trigger: newAutomation.trigger
      });
      
      if (result?.automation) {
        setAutomations(prev => [...prev, result.automation]);
        setNewAutomation({ name: '', description: '', trigger: 'manual' });
        setIsCreating(false);
      }
    } catch (err) {
      setError('Failed to create automation');
    }
  };

  return (
    <div className="automation-center">
      <header className="automation-header">
        <h1>⚡ Automation Center</h1>
        <p>Create and manage automated workflows</p>
      </header>

      {error && (
        <div className="automation-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="automation-actions">
        <button 
          className="btn-primary"
          onClick={() => setIsCreating(true)}
          disabled={isCreating}
        >
          + New Automation
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
            <label htmlFor="auto-name">Name:</label>
            <input
              id="auto-name"
              type="text"
              value={newAutomation.name}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Automation name..."
            />
          </div>
          <div className="form-group">
            <label htmlFor="auto-desc">Description:</label>
            <textarea
              id="auto-desc"
              value={newAutomation.description}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, description: e.target.value }))}
              placeholder="What does this automation do?"
              rows={2}
            />
          </div>
          <div className="form-group">
            <label htmlFor="auto-trigger">Trigger:</label>
            <select
              id="auto-trigger"
              value={newAutomation.trigger}
              onChange={(e) => setNewAutomation(prev => ({ ...prev, trigger: e.target.value }))}
            >
              <option value="manual">Manual</option>
              <option value="schedule">Scheduled</option>
              <option value="event">Event-based</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleCreateAutomation}>
              Create
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
            <p>Create your first automation to get started!</p>
          </div>
        ) : (
          automations.map(automation => (
            <div key={automation.id} className={`automation-card ${automation.enabled ? 'enabled' : 'disabled'}`}>
              <div className="automation-info">
                <h3>{automation.name}</h3>
                <p>{automation.description}</p>
                <div className="automation-meta">
                  <span className="trigger-badge">{automation.trigger}</span>
                  {automation.lastRun && (
                    <span className="last-run">Last run: {new Date(automation.lastRun).toLocaleString()}</span>
                  )}
                </div>
              </div>
              <div className="automation-controls">
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${automation.name}`}
                    checked={automation.enabled}
                    onChange={() => toggleAutomation(automation.id)}
                  />
                  <span className="slider"></span>
                </label>
                <button 
                  className="btn-icon" 
                  onClick={() => runAutomation(automation.id)}
                  title="Run now"
                >
                  ▶
                </button>
                <button 
                  className="btn-icon btn-danger" 
                  onClick={() => deleteAutomation(automation.id)}
                  title="Delete"
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
