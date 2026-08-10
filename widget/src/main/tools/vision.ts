/**
 * HomeBot Vision Tools
 *
 * Allows HomeBot to analyse local image files using an Ollama multimodal model
 * (llava, moondream, bakllava, etc.).  Works offline — no network call beyond
 * the local Ollama instance.
 *
 * Tools:
 *   vision_describe — describe an image file in detail
 *   vision_query    — ask a specific question about an image file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { ToolDefinition, ToolHandler, ToolResult } from './types';
import { resolveUserPath } from './filesystem';
import { assertPermission, getSettings } from '../config-manager';

// ── Config helpers ─────────────────────────────────────────────────────────

export function getVisionConfig(): { ollamaUrl: string; visionModel: string } {
  try {
    // Static import (see line 19). A lazy require() here resolved to nothing
    // once electron-vite bundled the main process, so this always fell into
    // the catch below — silently ignoring the user's configured visionModel
    // and ollamaUrl in every built app.
    const s = getSettings();
    return {
      ollamaUrl: (s.ollamaUrl || process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
      visionModel: s.visionModel || process.env.OLLAMA_VISION_MODEL || 'moondream',
    };
  } catch {
    return {
      ollamaUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
      visionModel: process.env.OLLAMA_VISION_MODEL || 'moondream',
    };
  }
}

// ── Supported image extensions ─────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif']);

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

// ── HTTP helper — POST JSON to Ollama /api/generate (non-streaming) ────────

export function ollamaGenerate(
  ollamaUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf-8');
    const parsed = new URL(`${ollamaUrl}/api/generate`);
    const isHttps = parsed.protocol === 'https:';
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      },
    };

    const transport = isHttps ? https : http;
    const req = (transport as typeof http).request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => { raw += chunk.toString('utf-8'); });
      res.on('end', () => {
        try {
          // Ollama streams NDJSON — concat all response fields
          const lines = raw.trim().split('\n').filter(Boolean);
          let text = '';
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.response) text += obj.response;
            } catch { /* discard unparseable lines */ }
          }
          resolve(text.trim() || '(no response)');
        } catch (e) {
          reject(new Error(`Ollama response parse error: ${String(e)}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Ollama request failed: ${e.message}`)));
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Ollama vision request timed out after 60 s'));
    });
    req.write(payload);
    req.end();
  });
}

// ── Shared core ────────────────────────────────────────────────────────────

async function analyseImage(rawPath: string, prompt: string): Promise<ToolResult> {
  assertPermission('read_file');

  const resolved = path.resolve(resolveUserPath(rawPath.trim()));

  // Home-directory guard (mirrors filesystem.ts)
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (HOME && !resolved.toLowerCase().startsWith(HOME.toLowerCase())) {
    return { success: false, error: `Access denied: file must be within your home directory (${HOME})` };
  }

  if (!fs.existsSync(resolved)) {
    return { success: false, error: `File not found: ${resolved}` };
  }
  if (fs.statSync(resolved).isDirectory()) {
    return { success: false, error: 'Path points to a directory — please specify an image file' };
  }
  if (!isImageFile(resolved)) {
    const ext = path.extname(resolved).toLowerCase() || '(none)';
    return {
      success: false,
      error: `File extension "${ext}" is not a supported image type. Supported: ${[...IMAGE_EXTS].join(', ')}`,
    };
  }

  const stat = fs.statSync(resolved);
  if (stat.size > 20 * 1024 * 1024) {
    return { success: false, error: 'Image file too large (max 20 MB)' };
  }

  const { ollamaUrl, visionModel } = getVisionConfig();
  const base64 = fs.readFileSync(resolved).toString('base64');

  let response: string;
  try {
    response = await ollamaGenerate(ollamaUrl, {
      model: visionModel,
      prompt,
      images: [base64],
      stream: true, // NDJSON streaming — we concat all chunks
    });
  } catch (err: any) {
    return {
      success: false,
      error: `Vision model error: ${err.message || String(err)}. Is "${visionModel}" pulled in Ollama?`,
    };
  }

  return {
    success: true,
    result: {
      file: path.basename(resolved),
      model: visionModel,
      response,
    },
  };
}

// ── Tool definitions ───────────────────────────────────────────────────────

/** PNG capture of the docked browser, supplied by the main process. */
export interface BrowserCaptureResult {
  success: boolean;
  error?: string;
  base64?: string;
  url?: string;
  title?: string;
}

let browserCaptureProvider: (() => Promise<BrowserCaptureResult>) | null = null;

/** Wired once at startup so this module never imports Electron. */
export function setBrowserCaptureProvider(fn: (() => Promise<BrowserCaptureResult>) | null): void {
  browserCaptureProvider = fn;
}

/**
 * look_at_browser — answer a question about whatever the docked browser is
 * showing, in ONE tool call.
 *
 * The capture path existed since the browser panel shipped and was wired to
 * nothing: an IPC channel no renderer called and no tool exposed, so the
 * assistant could never actually look at a page. Found by auditing for the
 * "capability with no surface" pattern this codebase keeps producing.
 *
 * Single call rather than capture-then-describe on purpose. A 7B model
 * chaining two tools and passing a temp path between them fails often; one
 * call that does both is the shape small models get right.
 */
export const lookAtBrowserDef: ToolDefinition = {
  name: 'look_at_browser',
  description:
    'Look at the web page currently open in the browser panel and answer a question about it. '
    + 'Use this when the user asks what a page says, what is on screen, or to read/summarise '
    + 'the page they are viewing. Requires the browser panel to be open.',
  category: 'vision',
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'What to find out about the page. Defaults to a general description.',
      },
    },
    required: [],
  },
};

export const lookAtBrowserHandler: ToolHandler = async (args): Promise<ToolResult> => {
  // Injected at startup rather than imported. A relative runtime require()
  // does NOT survive electron-vite bundling (the main process is inlined into
  // one file and the require is emitted verbatim -> MODULE_NOT_FOUND), and a
  // static import would drag Electron into every test that touches the tool
  // registry. Same provider-hook shape as setAssistantBridgeProvider.
  if (!browserCaptureProvider) {
    return { success: false, error: 'The browser panel is not available in this context.' };
  }
  let capture: BrowserCaptureResult;
  try {
    capture = await browserCaptureProvider();
  } catch (err: any) {
    return { success: false, error: `Could not reach the browser panel: ${err?.message || err}` };
  }

  if (!capture?.success || !capture.base64) {
    return { success: false, error: capture?.error || 'Could not capture the browser panel.' };
  }

  const question = String(args?.question || '').trim()
    || 'Describe what this web page shows. Summarise the main content.';

  const { ollamaUrl, visionModel } = getVisionConfig();
  try {
    const response = await ollamaGenerate(ollamaUrl, {
      model: visionModel,
      prompt: question,
      images: [capture.base64],
      stream: true,
    });
    return {
      success: true,
      result: {
        url: capture.url,
        title: capture.title,
        model: visionModel,
        response,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Vision model error: ${err?.message || String(err)}. Is "${visionModel}" pulled in Ollama?`,
    };
  }
};

export const visionToolDefs: ToolDefinition[] = [
  {
    name: 'vision_describe',
    description:
      'Describe the contents of a local image file in detail using a multimodal vision model. ' +
      'Use this when the user asks "what is in this image", "describe this picture", or similar.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute or home-relative path to the image file (jpg, png, gif, webp, etc.)',
        },
      },
      required: ['file_path'],
    },
    category: 'vision',
  },
  {
    name: 'vision_query',
    description:
      'Ask a specific question about a local image file using a multimodal vision model. ' +
      'Use this when the user asks a question about what they can see in an image, ' +
      'wants to extract text from a screenshot, count objects, check colours, etc.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute or home-relative path to the image file',
        },
        question: {
          type: 'string',
          description: 'The question to answer about the image',
        },
      },
      required: ['file_path', 'question'],
    },
    category: 'vision',
  },
  lookAtBrowserDef,
];

// ── Tool handlers ──────────────────────────────────────────────────────────

export const visionToolHandlers: Record<string, ToolHandler> = {
  look_at_browser: lookAtBrowserHandler,


  vision_describe: async (args): Promise<ToolResult> => {
    const filePath = (args.file_path as string)?.trim();
    if (!filePath) return { success: false, error: 'file_path is required' };
    return analyseImage(filePath, 'Describe this image in detail. Include colours, objects, text, layout, and any notable features.');
  },

  vision_query: async (args): Promise<ToolResult> => {
    const filePath = (args.file_path as string)?.trim();
    const question = (args.question as string)?.trim();
    if (!filePath) return { success: false, error: 'file_path is required' };
    if (!question) return { success: false, error: 'question is required' };
    return analyseImage(filePath, question);
  },

};
