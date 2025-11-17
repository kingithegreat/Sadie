import { ipcMain, BrowserWindow, IpcMainEvent } from 'electron';
import axios from 'axios';
import streamFromSadieProxy from './stream-proxy-client';
import { SadieRequest, SadieResponse, SadieRequestWithImages } from '../shared/types';
import { IPC_SEND_MESSAGE, SADIE_WEBHOOK_PATH } from '../shared/constants';
import { getMainWindow } from './window-manager';

const DEFAULT_TIMEOUT = 30000;

// Image attachment limits (mirror renderer defaults)
const MAX_IMAGES = 5;
const MAX_PER_IMAGE = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL = 10 * 1024 * 1024; // 10 MB

function estimateSizeFromBase64(base64?: string) {
  if (!base64) return 0;
  // Rough estimate: every 4 base64 chars -> 3 bytes
  return Math.floor((base64.length * 3) / 4);
}

function validateImages(images?: any[]) {
  if (!images || !Array.isArray(images) || images.length === 0) return { ok: true };
  if (images.length > MAX_IMAGES) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Too many images (max ${MAX_IMAGES}).` };

  let total = 0;
  for (const img of images) {
    let size = 0;
    if (typeof img.size === 'number') size = img.size;
    else if (typeof img.data === 'string') size = estimateSizeFromBase64(img.data);
    // if size still zero, we can't validate confidently; treat as ok
    if (size > MAX_PER_IMAGE) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Image ${img.filename || ''} exceeds per-image limit (${MAX_PER_IMAGE} bytes).` };
    total += size;
    if (total > MAX_TOTAL) return { ok: false, code: 'IMAGE_LIMIT_EXCEEDED', message: `Total attachments exceed ${MAX_TOTAL} bytes.` };
  }
  return { ok: true };
}

// Track active streams (Node Readable) by streamId so we can cancel them
const activeStreams: Map<string, { destroy?: () => void; stream?: NodeJS.ReadableStream }> = new Map();

function mapErrorToSadieResponse(error: any): SadieResponse {
  if (error.code === 'ECONNREFUSED') {
    return {
      success: false,
      error: true,
      message: 'Connection refused by backend.',
      details: error.message,
      response: 'NETWORK_ERROR'
    };
  }
  if (error.code === 'ECONNABORTED') {
    return {
      success: false,
      error: true,
      message: 'Request timed out.',
      details: error.message,
      response: 'TIMEOUT'
    };
  }
  return {
    success: false,
    error: true,
    message: 'Unknown error occurred.',
    details: error.message,
    response: 'UNKNOWN_ERROR'
  };
}

export function registerMessageRouter(mainWindow: BrowserWindow, n8nUrl: string) {
    // Streaming responses via HTTP chunked response (POST -> stream)
    ipcMain.on('sadie:stream-message', async (event: IpcMainEvent, request: SadieRequestWithImages & { streamId?: string }) => {
      const streamId = request?.streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

      if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
        event.sender.send('sadie:stream-error', { error: true, message: 'Invalid request format.', streamId });
        return;
      }

      // Validate images (if provided) to guard the backend from oversized payloads
      const validation = validateImages((request as any).images);
      if (!validation.ok) {
        event.sender.send('sadie:stream-error', { error: true, code: validation.code, message: validation.message, streamId });
        return;
      }

      try {
        const streamUrl = `${n8nUrl}${SADIE_WEBHOOK_PATH}/stream`;

        // notify renderer that stream is starting
        event.sender.send('sadie:stream-start', { streamId });

        // POST the request and expect a streaming (chunked) response
        const useProxy = !!(process.env.SADIE_PROXY_URL || process.env.SADIE_USE_PROXY === 'true');
        if (useProxy) {
          const proxyOpts = {
            proxyUrl: process.env.SADIE_PROXY_URL,
            apiKey: process.env.PROXY_API_KEYS || process.env.PROXY_API_KEY
          };

          const handler = streamFromSadieProxy(request, (chunk) => {
            try {
              // forward raw chunk to renderer
              event.sender.send('sadie:stream-chunk', { chunk: chunk.toString?.() || String(chunk), streamId });
            } catch (err) {}
          }, () => {
            try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          }, (err) => {
            try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming error', details: err, streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          }, proxyOpts);

          // store cancellation function
          activeStreams.set(streamId, { destroy: handler.cancel });
        } else {
          const res = await axios.post(streamUrl, request, {
            responseType: 'stream',
            timeout: 0,
            headers: { 'Content-Type': 'application/json' }
          });

          const stream = res.data as NodeJS.ReadableStream;

          // store stream so it can be cancelled
          activeStreams.set(streamId, { stream, destroy: () => { try { (stream as any).destroy?.(); } catch (e) {} } });

          stream.on('data', (chunk: Buffer) => {
          try {
            const text = chunk.toString('utf8');
            // Forward raw chunk to renderer; renderer will append it to the assistant message
            event.sender.send('sadie:stream-chunk', { chunk: text, streamId });
          } catch (err) {
            // ignore chunk parse errors
          }
        });

          stream.on('end', () => {
            try { event.sender.send('sadie:stream-end', { streamId }); } catch (e) {}
            activeStreams.delete(streamId);
          });

          stream.on('error', (err: any) => {
            try { event.sender.send('sadie:stream-error', { error: true, message: 'Streaming error', details: err, streamId }); } catch (e) {}
            try { (stream as any).destroy(); } catch (e) {}
            activeStreams.delete(streamId);
          });
        }
      } catch (error: any) {
        event.sender.send('sadie:stream-error', { error: true, message: 'Unknown streaming error', details: error?.message || error, streamId });
      }
    });

    // Cancel a running stream by id (or all if no id provided)
    ipcMain.on('sadie:stream-cancel', (_event: IpcMainEvent, payload: { streamId?: string }) => {
      const { streamId } = payload || {};
      if (!streamId) {
        // cancel all
        for (const [id, entry] of activeStreams.entries()) {
          try { entry.destroy?.(); } catch (e) {}
          try { (entry.stream as any)?.destroy?.(); } catch (e) {}
          activeStreams.delete(id);
        }
        return;
      }

      const entry = activeStreams.get(streamId);
      if (entry) {
        try { entry.destroy?.(); } catch (e) {}
        try { (entry.stream as any)?.destroy?.(); } catch (e) {}
        activeStreams.delete(streamId);
        // notify renderer the stream ended due to cancel
        _event?.sender?.send('sadie:stream-end', { streamId, cancelled: true });
      }
    });
  ipcMain.handle(IPC_SEND_MESSAGE, async (_event, request: SadieRequestWithImages | SadieRequest) => {
    if (!request || typeof request !== 'object' || !request.user_id || !request.message || !request.conversation_id) {
      return {
        success: false,
        error: true,
        message: 'Invalid request format.',
        response: 'VALIDATION_ERROR'
      };
    }

    // Validate images if present
    const validation = validateImages((request as any).images);
    if (!validation.ok) {
      return {
        success: false,
        error: true,
        code: validation.code,
        message: validation.message
      } as any;
    }

    try {
      const response = await axios.post(`${n8nUrl}${SADIE_WEBHOOK_PATH}`, request, {
        timeout: DEFAULT_TIMEOUT,
        headers: { 'Content-Type': 'application/json' }
      });
      return {
        success: true,
        data: response.data
      };
    } catch (error: any) {
      return mapErrorToSadieResponse(error);
    }
  });
}
