import React from 'react';

export default function PermissionModal({ open, missingPermissions, reason, requestId, onClose }: {
  open: boolean;
  missingPermissions: string[];
  reason?: string;
  requestId?: string;
  onClose: () => void;
}) {
  if (!open || !requestId) return null;

  const allowOnce = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'allow_once', missingPermissions);
    onClose();
  };

  const alwaysAllow = async () => {
    try {
      // Enable permissions in settings for immediate UI feedback
      const settings = await (window as any).electron.getSettings();
      const perms = settings.permissions || {};
      for (const p of missingPermissions) perms[p] = true;
      await (window as any).electron.saveSettings({ permissions: perms });
    } catch (e) { /* ignore */ }
    (window as any).electron.sendPermissionResponse(requestId!, 'always_allow', missingPermissions);
    onClose();
  };

  const cancel = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'cancel');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="w-[620px] max-w-[95vw] rounded-2xl bg-zinc-950 border border-zinc-800 p-4 shadow-lg">
        <h2 className="text-lg font-semibold mb-2">Permission Required</h2>
        <p className="text-sm text-zinc-400 mb-4">This action requires the following permissions:</p>
        <div className="mb-3">
          {missingPermissions.map((p) => (<div key={p} className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-sm">{p.replace(/_/g,' ')}</div>))}
        </div>
        <div className="text-sm text-zinc-500 mb-4">{reason || 'This action will modify files on your system.'}</div>

        <div className="flex justify-end gap-2">
          <button className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800" onClick={cancel}>Cancel</button>
          <button className="px-3 py-2 rounded-lg bg-yellow-600 text-black" onClick={allowOnce}>Allow once</button>
          <button className="px-3 py-2 rounded-lg bg-indigo-600 text-white" onClick={alwaysAllow}>Always allow</button>
        </div>
      </div>
    </div>
  );
}
