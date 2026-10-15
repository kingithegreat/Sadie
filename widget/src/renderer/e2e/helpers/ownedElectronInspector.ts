import type { ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import type { NativeAppMonitor } from './nativeAppProcess';

export interface OwnedElectronInspector { status(): { nodeClosed: boolean; socketState: number }; close(): boolean; terminate(): boolean }

/** Audited 1.57.0 Electron custom close only quits app and closes its node WS. */
export function captureOwnedElectronInspector(app: ElectronApplication, child: ChildProcess, monitor: NativeAppMonitor): OwnedElectronInspector | undefined {
  if (require('playwright-core/package.json').version !== '1.57.0') return undefined;
  const client = app as any;
  const impl = client._connection?.toImpl?.(app);
  const connection = impl?._nodeConnection, transport = connection?._transport, socket = transport?._ws;
  const identity = { pid: monitor.info.pid, ppid: monitor.info.ppid, creation: monitor.creation };
  const captured = () => impl?.process?.() === child &&
    (identity.pid === child.pid || identity.ppid === child.pid) && monitor.info.pid === identity.pid && monitor.info.ppid === identity.ppid && monitor.creation === identity.creation &&
    (process.platform !== 'win32' || /^\d{1,19}$/.test(identity.creation || '')) &&
    impl?._nodeConnection === connection && impl?._nodeSession === connection?.rootSession && connection?._transport === transport && transport?._ws === socket &&
    typeof connection?.close === 'function' && typeof connection?._closed === 'boolean' && typeof socket?.terminate === 'function' && Number.isInteger(socket?.readyState);
  const owned = () => {
    if (!captured()) return false;
    // Playwright removes this dispatcher when the actual process exits. A
    // missing mapping never grants permission to close or terminate a socket.
    try { return client._connection?.toImpl?.(app) === impl; } catch { return false; }
  };
  if (!owned()) return undefined;
  let closeRequested = false;
  return {
    // Passive captured diagnostics remain readable after dispatcher disposal.
    // They grant no action authority and never replace the held native oracle.
    status: () => { if (!captured()) throw new Error('Owned Electron inspector identity changed.'); return { nodeClosed: connection._closed, socketState: socket.readyState }; },
    close: () => {
      if (!owned()) throw new Error('Owned Electron inspector identity changed.');
      // Playwright 1.57 CRConnection.close -> WebSocketTransport.close ->
      // ws.close performs the normal handshake without evaluating app.quit.
      if (!closeRequested && !connection._closed && (socket.readyState === 1 || socket.readyState === 2)) {
        closeRequested = true; connection.close(); return true;
      }
      return false;
    },
    terminate: () => {
      if (!owned()) throw new Error('Owned Electron inspector identity changed.');
      // ws.terminate closes this exact debugger socket, not a native process.
      // An independently closed connection can still retain this same captured
      // open/closing socket; the bounded fallback revalidates its ownership.
      if (socket.readyState === 1 || socket.readyState === 2) { socket.terminate(); return true; }
      return false;
    },
  };
}
