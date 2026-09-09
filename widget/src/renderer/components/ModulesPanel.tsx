import React, { useState } from 'react';
import type { AppMode } from '../../shared/modes';
import type { ModuleSnapshotV1 } from '../../shared/modules/contracts';
import type { useModules } from '../modules/useModules';
import { registeredModuleViews } from '../modules/bundled';
import './ModulesPanel.css';

function moduleStatus(module: ModuleSnapshotV1): string {
  if (module.access === 'locked') return 'Locked';
  return { disabled: 'Disabled', enabled: 'Enabled', enabling: 'Starting', draining: 'Finishing current work', failed: 'Unavailable' }[module.state];
}

const ModulesPanel: React.FC<{ state: ReturnType<typeof useModules>; onOpen: (mode: AppMode) => void }> = ({ state, onOpen }) => {
  const [pending, setPending] = useState<string>();
  const [changeError, setChangeError] = useState<string>();
  const toggle = async (module: ModuleSnapshotV1) => {
    setPending(module.manifest.id);
    setChangeError(undefined);
    const result = await state.change(module.manifest.id, module.state !== 'enabled');
    if (!result.ok) setChangeError(result.error || 'Could not change this module. Try again.');
    setPending(undefined);
  };
  return <section className="modules-panel" aria-labelledby="modules-heading">
    <header className="modules-heading">
      <div><h1 id="modules-heading">Modules</h1><p>Choose the workspaces and tools you want in HomeBot.</p></div>
      <button type="button" className="modules-button" onClick={() => { void state.refresh(); }}>Refresh</button>
    </header>
    {state.loading && <p role="status">Loading modules…</p>}
    {(state.error || changeError) && <p className="modules-notice" role="alert">{changeError || state.error}</p>}
    {state.warning && <p className="modules-notice" role="alert">{state.warning}</p>}
    {!state.loading && !state.error && !state.modules.length && <p>No modules are installed.</p>}
    {state.modules.map(module => {
      const { manifest } = module;
      const view = registeredModuleViews([module])[0];
      const busy = pending === manifest.id || module.state === 'enabling' || module.state === 'draining';
      return <article className="module-card" key={manifest.id} aria-label={manifest.display.name}>
        <div className="module-card-heading">
          <div><h2>{manifest.display.name}</h2><p>{manifest.display.description}</p></div>
          <span className="module-state" data-state={module.state} role="status">{moduleStatus(module)}</span>
        </div>
        <p className="module-meta">Installed · Version {manifest.version} · {manifest.publisher}</p>
        {module.failure && <p className="modules-notice" role="alert">{module.failure.message}</p>}
        {module.access === 'locked' && <p>This module needs a valid license before it can run.</p>}
        {module.state === 'draining'
          ? <p>Current work is finishing. New actions are stopped, and this module will stay off after restart.</p>
          : <p>Disabling removes this workspace and its tools. Your projects and files stay on this PC.</p>}
        <dl className="module-details">
          <div><dt>Required modules</dt><dd>{manifest.dependencies.length
            ? manifest.dependencies.map(dep => state.modules.find(item => item.manifest.id === dep.id)?.manifest.display.name || dep.id).join(', ')
            : 'None'}</dd></div>
          <div><dt>Optional connections</dt><dd>{manifest.optionalIntegrations.join(', ') || 'None'}</dd></div>
        </dl>
        <details className="module-permissions"><summary>Requested permissions ({manifest.permissions.length})</summary>
          <p>Enabling a module keeps your existing permission and Online choices. Permission requests still appear when needed.</p>
          <ul>{manifest.permissions.map(permission => <li key={permission}>{permission.replace(/_/g, ' ')}</li>)}</ul>
        </details>
        <div className="module-actions">
          <button type="button" className="modules-button modules-button-primary"
            disabled={busy || (!!pending && pending !== manifest.id) || (module.access === 'locked' && module.state !== 'enabled') || module.failure?.code === 'DISPOSAL_FAILED'}
            onClick={() => { void toggle(module); }}>
            {module.state === 'draining' ? 'Finishing current work…' : module.state === 'enabled' ? 'Disable' : 'Enable'}
          </button>
          {view && <button type="button" className="modules-button" onClick={() => onOpen(view.id)}>Open {view.label}</button>}
        </div>
      </article>;
    })}
  </section>;
};

export default ModulesPanel;
