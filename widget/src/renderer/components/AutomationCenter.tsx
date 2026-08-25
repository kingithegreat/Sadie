import React, { useState, useEffect, useCallback } from 'react';
import type { SavedAutomation, UpgradePrompt } from '../../shared/types';
import { UpgradeModal } from './UpgradeModal';

/** Detects the structured upgrade response a gated IPC handler returns. */
function gateBlock(result: any): UpgradePrompt | null {
  return result && result.status === 'upgrade_required' && result.upgrade ? result.upgrade : null;
}

/** Prefer the app's resolved checkout URL over the gate's placeholder default. */
function withCheckout(prompt: UpgradePrompt, checkoutUrl: string): UpgradePrompt {
  const dead = !prompt.upgradeUrl || prompt.upgradeUrl === 'homebot://upgrade' || prompt.upgradeUrl === 'sadie://upgrade'; // legacy sentinel persisted by pre-rename builds
  return dead && checkoutUrl ? { ...prompt, upgradeUrl: checkoutUrl } : prompt;
}

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
    instructions: 'Respond directly in chat with a morning digest: a warm greeting for the time of day, a motivational quote, a productivity tip, and a suggested focus area. Format with markdown headers. Do NOT create or write any files — just reply with the content.',
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
    instructions: 'Use the get_system_info tool to check disk usage, memory, and CPU. Use list_processes to check running processes. Check if Ollama is running and what models are installed. Report any issues directly in chat.',
    trigger: 'manual',
  },
  {
    icon: '\u{1F4CB}',
    name: 'Smart Standup',
    description: 'Daily standup with quote, focus areas, and checklist',
    instructions: 'Respond directly in chat with a daily standup briefing: a greeting for the time of day, a motivational quote, 3 specific focus areas for a developer, a standup checklist, and a pro tip. Use markdown formatting and emojis. Do NOT create or write any files.',
    trigger: 'schedule',
    scheduleMinutes: 1440,
  },
];

export interface AutomationCenterProps {
  /**
   * Context handed over when the assistant sent the user here, so the create
   * form opens holding what was just discussed in chat instead of blank. Keys
   * it does not understand are ignored, which is what lets other callers hand
   * over richer context later without changing this signature.
   */
  navContext?: Record<string, unknown> | null;
}

export const AutomationCenter: React.FC<AutomationCenterProps> = ({ navContext }) => {
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
  const [formTrigger, setFormTrigger] = useState<'manual' | 'schedule' | 'file'>('manual');
  const [formSchedule, setFormSchedule] = useState(60);
  const [formWatchPath, setFormWatchPath] = useState('');
  const [formWatchPattern, setFormWatchPattern] = useState('');
  const [formN8nUrl, setFormN8nUrl] = useState('');

  // Open the create form already filled in when the assistant sent the user
  // here with context. Without this the handoff is only a redirect: someone who
  // just described an automation in chat would arrive at an empty form and have
  // to type it all again.
  //
  // Only fills blank fields, so arriving here a second time cannot wipe work in
  // progress.
  useEffect(() => {
    if (!navContext) return;
    const name = typeof navContext.name === 'string' ? navContext.name.trim() : '';
    const instructions =
      typeof navContext.instructions === 'string' ? navContext.instructions.trim() : '';
    const description =
      typeof navContext.description === 'string' ? navContext.description.trim() : '';
    if (!name && !instructions && !description) return;

    setIsCreating(true);
    if (name) setFormName(prev => prev || name);
    if (instructions) setFormInstructions(prev => prev || instructions);
    if (description) setFormDesc(prev => prev || description);
  }, [navContext]);
  const [formUseN8n, setFormUseN8n] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [n8nOnline, setN8nOnline] = useState(false);
  const [n8nBase, setN8nBase] = useState('http://localhost:5678');
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);
  const [isPro, setIsPro] = useState(true); // assume unlocked until status resolves
  const [checkoutUrl, setCheckoutUrl] = useState('homebot://upgrade');
  const [pendingDelete, setPendingDelete] = useState<SavedAutomation | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editTrigger, setEditTrigger] = useState<'manual' | 'schedule' | 'file'>('manual');
  const [editSchedule, setEditSchedule] = useState(60);
  const [editWatchPath, setEditWatchPath] = useState('');
  const [editWatchPattern, setEditWatchPattern] = useState('');
  // The create form collects a description and an optional webhook URL; the
  // edit form collected neither, so both could be set once and never changed.
  // The IPC handler has always accepted them — only the interface never sent
  // them, which made a stored value uneditable rather than unsupported.
  const [editDesc, setEditDesc] = useState('');
  const [editN8nUrl, setEditN8nUrl] = useState('');

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

  // Check n8n availability on mount
  useEffect(() => {
    window.electron?.checkConnection?.().then((status: any) => {
      setN8nOnline(status?.n8n === 'online');
    }).catch(() => {});
  }, []);

  /**
   * Where n8n actually is. These two buttons used to open a hardcoded
   * http://localhost:5678, so anyone running n8n on another port or host was
   * sent to the wrong place — while the deploy path a few lines away in main
   * read the setting correctly.
   */
  useEffect(() => {
    window.electron?.getSettings?.().then((s: any) => {
      const url = (s?.n8nUrl || '').trim().replace(/\/+$/, '');
      if (url) setN8nBase(url);
    }).catch(() => {});
  }, []);

  // Resolve Pro entitlement so we can show the upsell banner up front.
  useEffect(() => {
    (window as any).electron?.licenseStatus?.().then((status: any) => {
      if (status?.tier) setIsPro(status.tier === 'pro');
      if (status?.upgradeUrl) setCheckoutUrl(status.upgradeUrl);
    }).catch(() => {});
  }, []);

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
        watchPath: formTrigger === 'file' ? formWatchPath.trim() : undefined,
        watchPattern: formTrigger === 'file' ? (formWatchPattern.trim() || undefined) : undefined,
        n8nWebhookUrl: formN8nUrl.trim() || undefined,
        deployToN8n: formUseN8n,
      });
      const blocked = gateBlock(result);
      if (blocked) { setIsPro(false); setUpgradePrompt(withCheckout(blocked, checkoutUrl)); return; }
      if (result?.automation) {
        setAutomations(prev => [...prev, result.automation]);
        setFormName('');
        setFormDesc('');
        setFormInstructions('');
        setFormTrigger('manual');
        setFormWatchPath('');
        setFormWatchPattern('');
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
  }, [formName, formDesc, formInstructions, formTrigger, formSchedule, formWatchPath, formWatchPattern, formUseN8n, formN8nUrl, checkoutUrl]);

  const handleToggle = useCallback(async (id: string) => {
    const auto = automations.find(a => a.id === id);
    if (!auto) return;
    try {
      const result = await window.electron?.updateAutomation?.({ id, enabled: !auto.enabled });
      const blocked = gateBlock(result);
      if (blocked) { setIsPro(false); setUpgradePrompt(withCheckout(blocked, checkoutUrl)); return; }
      setAutomations(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
    } catch {
      setError('Failed to update automation');
    }
  }, [automations, checkoutUrl]);

  const handleRun = useCallback(async (id: string) => {
    setRunningId(id);
    setError(null);
    try {
      const result = await window.electron?.runAutomation?.({ id });
      const blocked = gateBlock(result);
      if (blocked) { setIsPro(false); setUpgradePrompt(withCheckout(blocked, checkoutUrl)); setRunningId(null); return; }
      const failed = !result?.result || result?.error;
      setAutomations(prev => prev.map(a => a.id === id ? {
        ...a,
        lastRun: new Date().toISOString(),
        lastResult: result?.result || result?.error || 'Done',
        lastStatus: failed ? 'error' : 'success',
      } : a));
      setExpandedId(id);
    } catch {
      setAutomations(prev => prev.map(a => a.id === id ? {
        ...a,
        lastRun: new Date().toISOString(),
        lastResult: 'Failed to run automation',
        lastStatus: 'error',
      } : a));
      setError('Failed to run automation');
    } finally {
      setRunningId(null);
    }
  }, [checkoutUrl]);

  /**
   * Deleting is irreversible and the button sits beside Run, so it asks first.
   * The prompt names the automation and says whether an n8n workflow goes with
   * it, because those are the two things that decide whether you meant it.
   */
  const handleDelete = useCallback(async (id: string) => {
    const auto = automations.find(a => a.id === id);
    if (!auto) return;
    setPendingDelete(auto);
  }, [automations]);

  const confirmDelete = useCallback(async (force: boolean) => {
    const auto = pendingDelete;
    if (!auto) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await window.electron?.deleteAutomation?.({ id: auto.id, force });
      if (result && result.success === false) {
        // The main process kept the automation on purpose — surface why, and
        // offer the override rather than leaving the user stuck.
        setError(result.error || 'Failed to delete automation');
        setDeleteBlocked(true);
        return;
      }
      if (result?.warning) setError(result.warning);
      setAutomations(prev => prev.filter(a => a.id !== auto.id));
      setPendingDelete(null);
      setDeleteBlocked(false);
    } catch {
      setError('Failed to delete automation');
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
    setDeleteBlocked(false);
  }, []);

  const startEdit = useCallback((auto: SavedAutomation) => {
    setEditingId(auto.id);
    setEditName(auto.name);
    setEditInstructions(auto.instructions);
    setEditTrigger(auto.trigger);
    setEditSchedule(auto.scheduleMinutes || 60);
    setEditWatchPath(auto.watchPath || '');
    setEditWatchPattern(auto.watchPattern || '');
    setEditDesc(auto.description || '');
    setEditN8nUrl(auto.n8nWebhookUrl || '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !editName.trim() || !editInstructions.trim()) return;
    try {
      await window.electron?.updateAutomation?.({
        id: editingId,
        name: editName.trim(),
        description: editDesc.trim(),
        instructions: editInstructions.trim(),
        trigger: editTrigger,
        scheduleMinutes: editTrigger === 'schedule' ? editSchedule : undefined,
        // Watch fields are sent whenever the automation uses (or just left) the
        // file trigger, so clearing the box actually clears the folder on disk
        // rather than silently keeping a stale watch.
        watchPath: editTrigger === 'file' ? editWatchPath.trim() : '',
        watchPattern: editTrigger === 'file' ? editWatchPattern.trim() : '',
        // Sent even when cleared, so emptying the field actually detaches the
        // workflow. The handler maps '' to undefined; omitting the key instead
        // would leave a stale URL in place and look like the edit was ignored.
        n8nWebhookUrl: editN8nUrl.trim(),
      });
      setAutomations(prev => prev.map(a => a.id === editingId ? {
        ...a,
        name: editName.trim(),
        description: editDesc.trim(),
        instructions: editInstructions.trim(),
        trigger: editTrigger,
        scheduleMinutes: editTrigger === 'schedule' ? editSchedule : a.scheduleMinutes,
        watchPath: editTrigger === 'file' ? editWatchPath.trim() : undefined,
        watchPattern: editTrigger === 'file' ? (editWatchPattern.trim() || undefined) : undefined,
        n8nWebhookUrl: editN8nUrl.trim() || undefined,
      } : a));
      setEditingId(null);
    } catch {
      setError('Failed to save changes');
    }
    // editDesc and editN8nUrl belong here. Without them the callback closes
    // over the values from the render that created it, so the new inputs looked
    // like they worked — the boxes updated on screen — while the ORIGINAL
    // values were sent to disk. Caught by the tests asserting what the handler
    // receives rather than what the form shows.
  }, [editingId, editName, editInstructions, editTrigger, editSchedule, editWatchPath, editWatchPattern, editDesc, editN8nUrl]);

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
    setFormUseN8n(n8nOnline);
    setFormN8nUrl('');
  }, [n8nOnline]);

  return (
    <div className="automation-center">
      <header className="automation-header">
        <h1>Automation Center</h1>
        <p>Create reusable workflows that chain HomeBot's tools together</p>
      </header>

      {!isPro && (
        <div className="automation-pro-banner" role="note">
          <span>⭐ <strong>HomeBot Pro</strong> — the Automation Center is a Pro feature. Creating and running automations requires an active license.</span>
          <button
            type="button"
            className="btn-primary"
            onClick={() => window.electron?.openExternalUrl?.((upgradePrompt?.upgradeUrl) || checkoutUrl)}
          >
            Upgrade to Pro
          </button>
        </div>
      )}

      <UpgradeModal prompt={upgradePrompt} onClose={() => setUpgradePrompt(null)} />

      {pendingDelete && (
        <div className="automation-confirm-backdrop" role="presentation" onClick={cancelDelete}>
          <div
            className="automation-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="automation-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="automation-confirm-title">Delete “{pendingDelete.name}”?</h3>
            <p>
              {pendingDelete.n8nWebhookUrl
                ? 'This removes the automation and the n8n workflow it deployed. It cannot be undone.'
                : 'This cannot be undone.'}
            </p>
            {deleteBlocked && (
              <p className="automation-confirm-blocked">
                The n8n workflow could not be removed. Deleting anyway leaves it running in n8n.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={cancelDelete} disabled={deleting}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => confirmDelete(deleteBlocked)}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : deleteBlocked ? 'Delete anyway' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

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
        {n8nOnline && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.electron?.openExternalUrl?.(`${n8nBase}/credentials`)}
              title="Manage API keys, OAuth tokens, and service credentials in n8n"
            >
              🔑 Credentials
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.electron?.openExternalUrl?.(n8nBase)}
              title="Open n8n workflow editor"
            >
              ⚙ n8n Dashboard
            </button>
          </>
        )}
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
              onChange={e => setFormTrigger(e.target.value as 'manual' | 'schedule' | 'file')}
            >
              <option value="manual">Manual (run on demand)</option>
              <option value="schedule">Scheduled</option>
              <option value="file">When a file appears in a folder</option>
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

          {formTrigger === 'file' && (
            <>
              <div className="form-group">
                <label htmlFor="auto-watch-path">Folder to watch</label>
                <input
                  id="auto-watch-path"
                  type="text"
                  value={formWatchPath}
                  onChange={e => setFormWatchPath(e.target.value)}
                  placeholder="e.g. C:\Users\you\Downloads\invoices"
                />
                <span className="form-hint">
                  The automation runs each time a new file appears in this folder. It must be inside your user folder.
                </span>
              </div>
              <div className="form-group">
                <label htmlFor="auto-watch-pattern">File name filter (optional)</label>
                <input
                  id="auto-watch-pattern"
                  type="text"
                  value={formWatchPattern}
                  onChange={e => setFormWatchPattern(e.target.value)}
                  placeholder="e.g. *.csv or report* — leave blank for any file"
                />
              </div>
            </>
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
              disabled={!formName.trim() || !formInstructions.trim() || deploying || (formTrigger === 'file' && !formWatchPath.trim())}
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
              {editingId === auto.id ? (
                <div className="automation-edit-form">
                  <label className="form-label" htmlFor="edit-name">Name</label>
                  <input id="edit-name" className="setting-input" placeholder="Automation name" value={editName} onChange={e => setEditName(e.target.value)} />
                  <label className="form-label" htmlFor="edit-instructions">Instructions</label>
                  <textarea id="edit-instructions" className="setting-input setting-textarea" placeholder="What should this automation do?" value={editInstructions} onChange={e => setEditInstructions(e.target.value)} rows={4} />
                  <label className="form-label" htmlFor="edit-description">Description</label>
                  <input
                    id="edit-description"
                    className="setting-input"
                    data-testid="edit-description"
                    placeholder="Short description of what this does"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                  />
                  <label className="form-label" htmlFor="edit-trigger">Trigger</label>
                  <select id="edit-trigger" className="setting-input" title="Trigger type" value={editTrigger} onChange={e => setEditTrigger(e.target.value as 'manual' | 'schedule' | 'file')}>
                    <option value="manual">Manual</option>
                    <option value="schedule">Schedule</option>
                    <option value="file">When a file appears</option>
                  </select>
                  {editTrigger === 'schedule' && (
                    <>
                      <label className="form-label" htmlFor="edit-schedule">Interval (minutes)</label>
                      <input id="edit-schedule" className="setting-input" type="number" min={1} placeholder="60" value={editSchedule} onChange={e => setEditSchedule(Number(e.target.value))} />
                    </>
                  )}
                  {editTrigger === 'file' && (
                    <>
                      <label className="form-label" htmlFor="edit-watch-path">Folder to watch</label>
                      <input
                        id="edit-watch-path"
                        className="setting-input"
                        data-testid="edit-watch-path"
                        placeholder="Folder inside your user folder"
                        value={editWatchPath}
                        onChange={(e) => setEditWatchPath(e.target.value)}
                      />
                      <label className="form-label" htmlFor="edit-watch-pattern">File name filter (optional)</label>
                      <input
                        id="edit-watch-pattern"
                        className="setting-input"
                        data-testid="edit-watch-pattern"
                        placeholder="*.csv, report* — blank for any file"
                        value={editWatchPattern}
                        onChange={(e) => setEditWatchPattern(e.target.value)}
                      />
                    </>
                  )}
                  <label className="form-label" htmlFor="edit-n8n-url">Workflow webhook URL</label>
                  <input
                    id="edit-n8n-url"
                    className="setting-input"
                    data-testid="edit-n8n-url"
                    placeholder="Leave blank to run this automation inside HomeBot"
                    value={editN8nUrl}
                    onChange={(e) => setEditN8nUrl(e.target.value)}
                  />
                  <small className="setting-hint">
                    Clearing this detaches the workflow — the automation keeps running, just inside
                    HomeBot rather than through your workflow server.
                  </small>
                  <div className="form-actions automation-edit-actions">
                    <button type="button" className="btn-primary" onClick={saveEdit} disabled={!editName.trim() || !editInstructions.trim() || (editTrigger === 'file' && !editWatchPath.trim())}>Save</button>
                    <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              ) : (<>
              <div className="automation-info">
                <div className="automation-title-row">
                  <h3>{auto.name}</h3>
                  <div className="automation-badges">
                    <span className="trigger-badge">{auto.trigger === 'file' ? 'on file' : auto.trigger}</span>
                    {auto.trigger === 'schedule' && auto.scheduleMinutes && (
                      <span className="schedule-badge">every {auto.scheduleMinutes >= 60 ? `${auto.scheduleMinutes / 60}h` : `${auto.scheduleMinutes}m`}</span>
                    )}
                    {auto.trigger === 'file' && auto.watchPath && (
                      <span className="schedule-badge" title={auto.watchPath}>
                        {auto.watchPattern ? `${auto.watchPattern} in ` : ''}
                        {auto.watchPath.split(/[\\/]/).filter(Boolean).pop() || auto.watchPath}
                      </span>
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
                    <span className={`automation-status-dot ${auto.lastStatus === 'error' ? 'status-error' : auto.lastStatus === 'success' ? 'status-success' : ''}`} />
                    <span className="last-run">
                      {auto.lastStatus === 'error' ? 'Failed' : 'Completed'} — {new Date(auto.lastRun).toLocaleString()}
                    </span>
                  </div>
                )}
                {runningId === auto.id && (
                  <div className="automation-meta automation-running-status">
                    <span className="automation-status-dot status-running" />
                    <span className="last-run">Running...</span>
                  </div>
                )}
                {auto.lastResult && (
                  <div className={`automation-result-section ${auto.lastStatus === 'error' ? 'result-error' : ''}`}>
                    <button
                      className="result-toggle"
                      onClick={() => setExpandedId(expandedId === auto.id ? null : auto.id)}
                      type="button"
                    >
                      {expandedId === auto.id ? '▾ Hide result' : '▸ Show last result'}
                    </button>
                    {expandedId === auto.id && (
                      <pre className={`automation-result ${auto.lastStatus === 'error' ? 'automation-result-error' : ''}`}>{auto.lastResult}</pre>
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
                  type="button"
                  className="btn-icon"
                  onClick={() => startEdit(auto)}
                  title="Edit"
                  aria-label={`Edit ${auto.name}`}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => handleRun(auto.id)}
                  title="Run now"
                  aria-label={`Run ${auto.name}`}
                  disabled={runningId !== null}
                >
                  {runningId === auto.id ? '⏳' : '▶'}
                </button>
                {/* #159's own confirmation flow handles this: handleDelete sets
                    pendingDelete, and its dialog also says whether an n8n
                    workflow goes with the automation — which the generic
                    ConfirmDestructive cannot know. Theirs is better informed for
                    this one control, so it wins; the shared primitive still
                    covers the other seven. */}
                <button
                  type="button"
                  className="btn-icon btn-danger"
                  onClick={() => handleDelete(auto.id)}
                  title="Delete"
                  aria-label={`Delete ${auto.name}`}
                  disabled={runningId === auto.id}
                >
                  🗑
                </button>
              </div>
              </>)}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AutomationCenter;
