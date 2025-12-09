import React, { useState, useEffect } from 'react';

interface Settings {
  alwaysOnTop: boolean;
  n8nUrl: string;
  widgetHotkey: string;
  uncensoredMode?: boolean;
}

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onSave,
  onClose
}) => {
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [uncensoredMode, setUncensoredMode] = useState(false);

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Load uncensored mode state on mount
  useEffect(() => {
    (window as any).electron?.getUncensoredMode?.().then((result: { enabled: boolean }) => {
      setUncensoredMode(result?.enabled || false);
    });
  }, []);

  const handleUncensoredToggle = async (enabled: boolean) => {
    setUncensoredMode(enabled);
    await (window as any).electron?.setUncensoredMode?.(enabled);
    // Model switches immediately - no restart needed
  };

  // Update local settings when props change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleCancel = () => {
    setLocalSettings(settings); // Reset to original
    onClose();
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="close-button" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="settings-body">
        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.alwaysOnTop}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  alwaysOnTop: e.target.checked
                })
              }
            />
            <span>Always on top</span>
          </label>
        </div>

        <div className="setting-group">
          <label className="setting-label">n8n URL</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.n8nUrl}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                n8nUrl: e.target.value
              })
            }
            placeholder="http://localhost:5678"
          />
        </div>

        <div className="setting-group">
          <label className="setting-label">Widget Hotkey (read-only)</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.widgetHotkey}
            readOnly
            disabled
          />
          <small className="setting-hint">
            Hotkey configuration requires restart
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">
            <input
              type="checkbox"
              checked={uncensoredMode}
              onChange={(e) => handleUncensoredToggle(e.target.checked)}
            />
            <span>🔓 Uncensored Mode</span>
          </label>
          <small className="setting-hint" style={{ color: uncensoredMode ? '#f59e0b' : undefined }}>
            {uncensoredMode 
              ? 'Using dolphin-llama3:8b - No content filters' 
              : 'Using llama3.2:3b - Standard safety filters'}
          </small>
        </div>
      </div>

      <div className="settings-footer">
        <button className="button button-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <button className="button button-save" onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;
