import React from "react";
import { useEffect, useState } from 'react';

export function Header({
  onOpenSettings,
  connectionStatus,
}: {
  onOpenSettings: () => void;
  connectionStatus: "online" | "offline" | "connecting";
}) {
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    (window as any).electron?.getMode?.().then((r: any) => {
      if (r && typeof r.demo !== 'undefined') setDemoMode(!!r.demo);
    }).catch(() => {});
  }, []);
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <h1 className="text-sm font-semibold tracking-wide">Sadie Widget</h1>
        <span className="text-xs text-zinc-400">
          {connectionStatus}
        </span>
        {demoMode && (
          <span style={{ marginLeft: 8, padding: '2px 8px', background: '#f59e0b', color: '#04111a', borderRadius: 6, fontSize: 11 }}>
            Demo Mode
          </span>
        )}
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
