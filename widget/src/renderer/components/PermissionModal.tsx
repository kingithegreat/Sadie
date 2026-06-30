

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
    <div data-role="permission-modal" className="hb-modal-overlay">
      <div className="hb-modal-card hb-modal-card-lg">
        <h2 className="hb-modal-title">Permission Required</h2>
        <p className="hb-modal-text">This action requires the following permissions:</p>
        <div className="hb-modal-consent-detail">
          {missingPermissions.map((p) => (
            <div key={p} className="hb-modal-perm-item">{p.replace(/_/g, ' ')}</div>
          ))}
        </div>
        <div className="hb-modal-muted">{reason || 'This action will modify files on your system.'}</div>

        <div className="hb-modal-actions">
          <button className="hb-modal-btn hb-modal-btn-secondary" onClick={cancel}>Cancel</button>
          <button className="hb-modal-btn hb-modal-btn-warning" onClick={allowOnce}>Allow once</button>
          <button className="hb-modal-btn hb-modal-btn-primary" onClick={alwaysAllow}>Always allow</button>
        </div>
      </div>
    </div>
  );
}
