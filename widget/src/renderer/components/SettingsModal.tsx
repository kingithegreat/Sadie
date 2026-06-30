import { useState } from "react";
import type { Settings } from "../types";

export function SettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState(settings);

  if (!open) return null;

  return (
    <div className="hb-modal-overlay">
      <div className="hb-modal-card hb-modal-card-sm">
        <h2 className="hb-modal-title">Settings</h2>

        <div className="hb-modal-fields">
          <label>
            <div className="hb-modal-label">Model</div>
            <input
              className="hb-modal-input"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </label>

          <label>
            <div className="hb-modal-label">Temperature</div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="hb-modal-input"
              value={draft.temperature}
              onChange={(e) =>
                setDraft({ ...draft, temperature: Number(e.target.value) })
              }
            />
          </label>

          <label>
            <div className="hb-modal-label">Max tokens</div>
            <input
              type="number"
              min="1"
              className="hb-modal-input"
              value={draft.maxTokens}
              onChange={(e) =>
                setDraft({ ...draft, maxTokens: Number(e.target.value) })
              }
            />
          </label>
        </div>

        <div className="hb-modal-actions">
          <button className="hb-modal-btn hb-modal-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="hb-modal-btn hb-modal-btn-primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
