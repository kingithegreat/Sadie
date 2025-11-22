import React from "react";

export function Header({
  onOpenSettings,
  connectionStatus,
}: {
  onOpenSettings: () => void;
  connectionStatus: "online" | "offline" | "connecting";
}) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <h1 className="text-sm font-semibold tracking-wide">Sadie Widget</h1>
        <span className="text-xs text-zinc-400">
          {connectionStatus}
        </span>
      </div>
      <button
        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:bg-zinc-800"
        onClick={onOpenSettings}
      >
        Settings
      </button>
    </header>
  );
}
