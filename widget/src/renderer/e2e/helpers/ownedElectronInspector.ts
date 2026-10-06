import type { ElectronApplication } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import type { NativeAppMonitor } from './nativeAppProcess';

export interface OwnedElectronInspector { status(): { nodeClosed: boolean; socketState: number }; terminate(): boolean }

/** Audited 1.57.0 Electron custom close only quits app and closes its node WS. */
export function captureOwnedElectronInspector(app: ElectronApplication, child: ChildProcess, monitor: NativeAppMonitor): OwnedElectronInspector | undefined {
  if (require('playwright-core/package.json').version !== '1.57.0') return undefined;
  const client = app as any;
  const impl = client._connection?.toImpl?.(app);
  const connection = impl?._nodeConnection, transport = connection?._transport, socket = transport?._ws;
  const identity = { pid: monitor.info.pid, ppid: monitor.info.ppid, creation: monitor.creation };
  const owned = () => client._connection?.toImpl?.(app) === impl && impl?.process?.() === child &&
    (identity.pid === child.pid || identity.ppid === child.pid) && monitor.info.pid === identity.pid && monitor.info.ppid === identity.ppid && monitor.creation === identity.creation &&
    (process.platform !== 'win32' || /^\d{1,19}$/.test(identity.creation || '')) &&
    impl?._nodeConnection === connection && impl?._nodeSession === connection?.rootSession && connection?._transport === transport && transport?._ws === socket &&
    typeof connection?.close === 'function' && typeof connection?._closed === 'boolean' && typeof socket?.terminate === 'function' && Number.isInteger(socket?.readyState);
  if (!owned()) return undefined;
  return {
    status: () => { if (!owned()) throw new Error('Owned Electron inspector identity changed.'); return { nodeClosed: connection._closed, socketState: socket.readyState }; },
    terminate: () => {
      if (!owned()) throw new Error('Owned Electron inspector identity changed.');
      // ws.terminate closes this exact debugger socket, not a native process.
      if (!connection._closed && (socket.readyState === 1 || socket.readyState === 2)) { socket.terminate(); return true; }
      return false;
    },
  };
}
