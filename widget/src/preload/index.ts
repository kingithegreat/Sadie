import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Use canonical shared types for the preload API
import {
  SadieRequest,
  SadieRequestWithImages,
  SadieResponse,
  ConnectionStatus,
  ElectronAPI,
  Settings,
} from '../shared/types';
import { IPC_SEND_MESSAGE } from '../shared/constants';

// No local duplicate ElectronAPI — we import the canonical type above and ensure our implementation matches it.

// Whitelist of allowed IPC channels
const ALLOWED_CHANNELS = {
  SEND: IPC_SEND_MESSAGE,
  RECEIVE: 'sadie:reply',
  GET_SETTINGS: 'sadie:get-settings',
  SAVE_SETTINGS: 'sadie:save-settings',
  SHOW_WINDOW: 'sadie:show-window',
  HIDE_WINDOW: 'sadie:hide-window',
  STREAM_SEND: 'sadie:stream-message',
  STREAM_CHUNK: 'sadie:stream-chunk',
  STREAM_END: 'sadie:stream-end',
  STREAM_ERROR: 'sadie:stream-error'
};

// Create the API object
const electronAPI: ElectronAPI = {
  /**
   * Send a message to SADIE backend
   */
  sendMessage: async (request: SadieRequest): Promise<SadieResponse> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.SEND, request);
  },

  // Start a streaming request. Non-blocking; return a Promise<void> to match shared types
  sendStreamMessage: async (request: SadieRequestWithImages): Promise<void> => {
    ipcRenderer.send(ALLOWED_CHANNELS.STREAM_SEND, request);
    // Fire-and-forget; return a resolved promise so callers can await
    return Promise.resolve();
  },

  /**
   * Listen for messages from SADIE backend
   * Returns an unsubscribe function
   */
  onMessage: (callback: (data: any) => void) => {
    const listener = (_event: IpcRendererEvent, data: any) => {
      callback(data);
    };

    ipcRenderer.on(ALLOWED_CHANNELS.RECEIVE, listener);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(ALLOWED_CHANNELS.RECEIVE, listener);
    };
  },

  onStreamChunk: (cb: (data: { streamId?: string; chunk: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => {
      // Expecting data = { streamId?: string, chunk: string }
      cb(data as { streamId?: string; chunk: string });
    };
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
  },

  onStreamEnd: (cb: (data: { streamId?: string; cancelled?: boolean }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data as { streamId?: string; cancelled?: boolean });
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_END, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_END, listener);
  },

  onStreamError: (cb: (data: { streamId?: string; error?: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, err: any) => cb(err as { streamId?: string; error?: string });
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_ERROR, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_ERROR, listener);
  },

  // removeStreamListeners is intentionally not exposed in the canonical API; use returned unsubscribes instead.

  // Cancel a running stream by id. If no id is provided, cancels all.
  cancelStream: (streamId?: string) => {
    ipcRenderer.send('sadie:stream-cancel', { streamId });
  },

  // Window show/hide event helpers
  onShowWindow: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(ALLOWED_CHANNELS.SHOW_WINDOW, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.SHOW_WINDOW, listener);
  },

  onHideWindow: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(ALLOWED_CHANNELS.HIDE_WINDOW, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.HIDE_WINDOW, listener);
  },

  removeShowWindowListener: () => {
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.SHOW_WINDOW);
  },

  removeHideWindowListener: () => {
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.HIDE_WINDOW);
  },

  /**
   * Get user settings from main process
   */
  getSettings: async (): Promise<Settings> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS) as Settings;
  },

  /**
   * Save user settings to main process
   */
  saveSettings: async (settings: Partial<Settings>): Promise<Settings> => {
    // saveSettings should return the updated settings object from main
    const result = await ipcRenderer.invoke(ALLOWED_CHANNELS.SAVE_SETTINGS, settings);
    return result as Settings;
  },

  checkConnection: async (): Promise<ConnectionStatus> => {
    return await ipcRenderer.invoke('sadie:check-connection');
  },

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close')
};

// Expose the API to the renderer process. Cast to the canonical ElectronAPI to ensure type alignment.
contextBridge.exposeInMainWorld('electron', electronAPI as unknown as ElectronAPI);

// Export types for TypeScript consumers
// Re-export the type (forwarded from shared/types)
export type { ElectronAPI };
