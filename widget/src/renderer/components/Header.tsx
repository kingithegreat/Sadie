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
    <header className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-800/50 bg-zinc-950/95 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
        <h1 className="text-sm font-semibold tracking-tight text-zinc-100">SADIE</h1>
        <span className="text-xs text-zinc-500 font-medium">
          {connectionStatus}
        </span>
        {demoMode && (
          <span className="header-demo-badge">
            Demo Mode
          </span>
        )}
      </div>
      <button
        className="text-xs px-3.5 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 hover:bg-zinc-800 hover:border-zinc-700 transition-all duration-200 font-medium"
        onClick={onOpenSettings}
      >
        Settings
      </button>
    </header>
  );
}
