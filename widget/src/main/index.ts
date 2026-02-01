// Clean main process for SADIE - simplified and self-contained
import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers() {
  ipcMain.handle('run-n8n-workflow', async (_event, { workflowId, data }) => {
    try {
      const webhookUrl = `http://localhost:5678/webhook/${workflowId}`;
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      });
      if (!res.ok) return { success: false, status: res.status, statusText: res.statusText };
      const json = await res.json().catch(() => null);
      return { success: true, data: json };
    } catch (err: any) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('run-ps-script', async (_event, { scriptName, args = [] }) => {
    return new Promise((resolve) => {
      try {
        const safe = String(scriptName || '').replace(/[^a-zA-Z0-9-_]/g, '');
        const scriptPath = join(process.cwd(), 'scripts', `${safe}.ps1`);
        const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], { windowsHide: true });
        let out = '';
        let errOut = '';
        ps.stdout.on('data', (d) => out += d.toString());
        ps.stderr.on('data', (d) => errOut += d.toString());
        ps.on('close', (code) => {
          if (code === 0) resolve({ success: true, output: out.trim() });
          else resolve({ success: false, error: errOut || out, code });
        });
      } catch (e) {
        resolve({ success: false, error: String(e) });
      }
    });
  });
}

function createMainWindow() {
  const iconPath = join(__dirname, '..', '..', 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon: process.platform === 'win32' ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler((details) => { shell.openExternal(details.url); return { action: 'deny' }; });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  ipcMain.on('ping', () => console.log('pong'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// Optional: auto-start n8n on Windows if helper exists
if (process.platform === 'win32') {
  try {
    const startScript = join(process.cwd(), 'scripts', 'start-n8n.ps1');
    // spawn detached if present
    // Note: Do not fail the app if start script is missing
    // spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', startScript], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {}
}
