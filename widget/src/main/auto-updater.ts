// Auto-update support using electron-updater
// Checks for updates from GitHub Releases on startup and notifies the user
import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';

/** Catch handler for fire-and-forget ops — logs instead of silently swallowing */
function safeCatch(e: unknown) { console.error('[SADIE-CATCH]', e); }

function isAutoUpdateEnabled(): boolean {
  return app.isPackaged && process.env.SADIE_ENABLE_AUTO_UPDATE === '1';
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  if (!isAutoUpdateEnabled()) {
    console.log('[UPDATER] Disabled: set SADIE_ENABLE_AUTO_UPDATE=1 for signed packaged releases');
    return;
  }

  // Disable auto-download — let the user decide
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[UPDATER] Update available: v${info.version}`);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sadie:update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    } catch (e) {
      console.error('[UPDATER] Failed to notify renderer:', e);
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[UPDATER] No updates available');
  });

  autoUpdater.on('error', (err) => {
    console.error('[UPDATER] Update check error:', err?.message || err);
  });

  autoUpdater.on('download-progress', (progress) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sadie:update-progress', {
          percent: Math.round(progress.percent),
        });
      }
    } catch (e) { safeCatch(e); }
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[UPDATER] Update downloaded, will install on quit');
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sadie:update-downloaded');
      }
    } catch (e) { safeCatch(e); }
  });

  // Check for updates after a short delay to avoid slowing startup
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[UPDATER] Check failed:', err?.message || err);
    });
  }, 5000);
}

/** Trigger download of a pending update (called from IPC) */
export function downloadUpdate(): void {
  if (!isAutoUpdateEnabled()) {
    console.log('[UPDATER] Download skipped because auto-updates are disabled');
    return;
  }

  autoUpdater.downloadUpdate().catch((err) => {
    console.error('[UPDATER] Download failed:', err?.message || err);
  });
}

/** Install downloaded update and restart */
export function installUpdate(): void {
  if (!isAutoUpdateEnabled()) {
    console.log('[UPDATER] Install skipped because auto-updates are disabled');
    return;
  }

  autoUpdater.quitAndInstall(false, true);
}
