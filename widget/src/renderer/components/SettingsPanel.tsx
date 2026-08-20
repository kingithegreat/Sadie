/**
 * The Settings panel shell.
 *
 * This file used to be 2,725 lines: every control and all of the state in one
 * function. The state now lives in settings/useSettingsState, the controls in
 * settings/*Tab, and what is left here is the frame — the view toggle, which
 * tabs each view shows, and the save bar.
 *
 * Simple vs Advanced exists because the panel had grown nine sections deep and
 * the settings that matter to most people (which model answers, whether chats
 * leave this PC, voice, theme) were scattered between MCP server ports, RAG
 * chunking and telemetry audit logs. Simple shows the first group; Advanced
 * shows everything, unchanged.
 *
 * The privacy switch sits above the toggle rather than inside a tab, because it
 * is the one setting that should never take a search to find.
 */

import { useState, useEffect } from 'react';
import type { Settings as SharedSettings } from '../../shared/types';
import UpgradeModal from './UpgradeModal';
import { useSettingsState } from './settings/useSettingsState';
import { SettingsProvider } from './settings/SettingsContext';
import PrivacySwitch from './settings/PrivacySwitch';
import GeneralSettingsTab from './settings/GeneralSettingsTab';
import ModelsSettingsTab from './settings/ModelsSettingsTab';
import VoiceHotkeysTab from './settings/VoiceHotkeysTab';
import PrivacySettingsTab from './settings/PrivacySettingsTab';
import AdvancedSettingsTab from './settings/AdvancedSettingsTab';

interface SettingsPanelProps {
  settings: SharedSettings;
  onSave: (settings: SharedSettings) => void;
  onClose: () => void;
}

type ViewMode = 'simple' | 'advanced';

/** Remembered across opens: someone who went looking for Advanced once will
 *  almost certainly want it again, and re-hiding it reads as a bug. */
const VIEW_MODE_KEY = 'homebot.settings.viewMode';

function loadViewMode(): ViewMode {
  try {
    return window.localStorage?.getItem(VIEW_MODE_KEY) === 'advanced' ? 'advanced' : 'simple';
  } catch {
    return 'simple';
  }
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onSave, onClose }) => {
  const state = useSettingsState({ settings, onSave, onClose });
  const {
    confirmDialog,
    panelRef,
    handleSave,
    handleCancel,
    hasUnsavedChanges,
    upgradePrompt,
    setUpgradePrompt,
  } = state;

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);

  useEffect(() => {
    try { window.localStorage?.setItem(VIEW_MODE_KEY, viewMode); } catch { /* private mode */ }
  }, [viewMode]);

  const advanced = viewMode === 'advanced';

  return (
    <SettingsProvider value={state}>
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      {confirmDialog}
      <div
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { onClose(); return; }
          // Ctrl/Cmd+S saves. The Save bar lives at the bottom of the panel, so
          // anything that pushes it out of view (a window taller than the
          // desktop, an unusual display scale) made settings unsaveable with no
          // way out. A keyboard path cannot be clipped.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            handleSave();
          }
        }}
        tabIndex={-1}
      >
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <div className="sp-view-toggle" role="group" aria-label="Settings detail level">
        <button
          type="button"
          className={`sp-view-btn${advanced ? '' : ' active'}`}
          aria-pressed={!advanced}
          onClick={() => setViewMode('simple')}
        >
          Simple
        </button>
        <button
          type="button"
          className={`sp-view-btn${advanced ? ' active' : ''}`}
          aria-pressed={advanced}
          onClick={() => setViewMode('advanced')}
        >
          Advanced
        </button>
      </div>

      <div className="settings-body">
        <PrivacySwitch />

        <ModelsSettingsTab />
        <VoiceHotkeysTab />
        <GeneralSettingsTab />

        {advanced && <>
          <PrivacySettingsTab />
          <AdvancedSettingsTab />
        </>}

        {!advanced && (
          <small className="setting-hint sp-view-hint">
            Looking for API keys, automations, permissions or diagnostics? They are under Advanced.
          </small>
        )}
      </div>{/* end settings-body */}

      <div className="settings-footer">
        <button className="button button-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <span className="settings-footer-hint">Ctrl+S</span>
        <button className={`button button-save${hasUnsavedChanges ? ' has-changes' : ''}`} onClick={handleSave}>
          {hasUnsavedChanges ? 'Save changes' : 'Save'}
        </button>
      </div>
      </div>
      <UpgradeModal prompt={upgradePrompt} onClose={() => setUpgradePrompt(null)} />
    </div>
    </SettingsProvider>
  );
};

export default SettingsPanel;
