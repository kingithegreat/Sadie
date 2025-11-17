import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Define the API interface
import { SadieRequest, SadieRequestWithImages, SadieResponse } from '../shared/types';
import { IPC_SEND_MESSAGE } from '../shared/constants';

interface ElectronAPI {
  sendMessage: (request: SadieRequest) => Promise<SadieResponse>;
  sendStreamMessage: (request: SadieRequestWithImages) => void;
  onStreamChunk: (cb: (chunk: { chunk?: string }) => void) => () => void;
  onStreamEnd: (cb: () => void) => () => void;
  onStreamError: (cb: (err: any) => void) => () => void;
  removeStreamListeners: () => void;
  cancelStream: (streamId?: string) => void;
  onMessage: (callback: (data: any) => void) => () => void;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<void>;
  minimizeWindow: () => void;
  closeWindow: () => void;
}

// Whitelist of allowed IPC channels
const ALLOWED_CHANNELS = {
  SEND: IPC_SEND_MESSAGE,
  RECEIVE: 'sadie:reply',
  GET_SETTINGS: 'sadie:get-settings',
  SAVE_SETTINGS: 'sadie:save-settings',
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

  // Start a streaming request. Non-blocking; chunks will arrive via onStreamChunk
  sendStreamMessage: (request: SadieRequestWithImages) => {
    ipcRenderer.send(ALLOWED_CHANNELS.STREAM_SEND, request);
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

  onStreamChunk: (cb: (chunk: { chunk?: string }) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => {
      cb(data);
    };
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_CHUNK, listener);
  },

  onStreamEnd: (cb: (data: any) => void) => {
    const listener = (_ev: IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_END, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_END, listener);
  },

  onStreamError: (cb: (err: any) => void) => {
    const listener = (_ev: IpcRendererEvent, err: any) => cb(err);
    ipcRenderer.on(ALLOWED_CHANNELS.STREAM_ERROR, listener);
    return () => ipcRenderer.removeListener(ALLOWED_CHANNELS.STREAM_ERROR, listener);
  },

  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.STREAM_CHUNK);
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.STREAM_END);
    ipcRenderer.removeAllListeners(ALLOWED_CHANNELS.STREAM_ERROR);
  },

  // Cancel a running stream by id. If no id is provided, cancels all.
  cancelStream: (streamId?: string) => {
    ipcRenderer.send('sadie:stream-cancel', { streamId });
  },

  /**
   * Get user settings from main process
   */
  getSettings: async (): Promise<any> => {
    return await ipcRenderer.invoke(ALLOWED_CHANNELS.GET_SETTINGS);
  },

  /**
   * Save user settings to main process
   */
  saveSettings: async (settings: any): Promise<void> => {
    await ipcRenderer.invoke(ALLOWED_CHANNELS.SAVE_SETTINGS, settings);
  },

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close')
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electron', electronAPI);

// Export types for TypeScript consumers
export type { ElectronAPI };
