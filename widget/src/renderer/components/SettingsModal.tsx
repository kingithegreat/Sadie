import React, { useState } from "react";
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[520px] max-w-[95vw] rounded-2xl bg-zinc-950 border border-zinc-800 p-4 shadow-lg">
        <h2 className="text-base font-semibold mb-3">Settings</h2>

        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="text-zinc-400 mb-1">Model</div>
            <input
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
          </label>

          <label className="block">
            <div className="text-zinc-400 mb-1">Temperature</div>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
              value={draft.temperature}
              onChange={(e) =>
                setDraft({ ...draft, temperature: Number(e.target.value) })
              }
            />
          </label>

          <label className="block">
            <div className="text-zinc-400 mb-1">Max tokens</div>
            <input
              type="number"
              min="1"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2"
              value={draft.maxTokens}
              onChange={(e) =>
                setDraft({ ...draft, maxTokens: Number(e.target.value) })
              }
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
