/**
 * Reusable CodeMirror 6 bridge to a language server running in the main
 * process. It is server-agnostic: any server in the main-process registry
 * (pyright today; gopls/rust-analyzer by config later) gets completion,
 * hover, diagnostics and go-to-definition through the same IPC transport.
 */
import { hoverTooltip } from '@codemirror/view';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { LspRequest, LspResult } from '../../../../shared/workspace-lsp-types';

export interface LspContext { root?: string; filePath?: string }
export type LspTransport = (request: LspRequest) => Promise<LspResult>;
/** File types the main-process registry currently enables. Keep in sync with lsp-servers.ts. */
export const LSP_FILE = /\.pyi?$/i;
export const lspHandles = (context: LspContext) => !!context.root && !!context.filePath && LSP_FILE.test(context.filePath);

export const ipcTransport: LspTransport = async request => {
  const api = (window as any).electron;
  if (!api?.workspaceLsp) return { success: false, error: 'Language servers are unavailable in this build.' };
  return api.workspaceLsp(request);
};

export async function lspCompletion(context: LspContext, completion: CompletionContext, transport: LspTransport = ipcTransport): Promise<CompletionResult | null> {
  if (!lspHandles(context)) return null;
  const word = completion.matchBefore(/\w*/);
  const trigger = completion.state.doc.sliceString(Math.max(0, completion.pos - 1), completion.pos);
  if (!word || (!completion.explicit && word.from === word.to && trigger !== '.')) return null;
  try {
    const result = await transport({ action: 'complete', root: context.root!, path: context.filePath!, content: completion.state.doc.toString(), position: completion.pos });
    if (!result.success || completion.aborted || !result.entries?.length) return null;
    return { from: result.from ?? word.from, options: result.entries.map(entry => ({ label: entry.label, detail: entry.detail, type: entry.kind, apply: entry.insertText && entry.insertText !== entry.label ? entry.insertText : undefined })), validFor: /^\w*$/ };
  } catch { return null; }
}

export function lspExtensions(context: () => LspContext, transport: LspTransport = ipcTransport): Extension {
  return [
    hoverTooltip(async (view, position) => {
      const current = context(); if (!lspHandles(current)) return null;
      const before = view.state.doc.toString();
      try {
        const result = await transport({ action: 'hover', root: current.root!, path: current.filePath!, content: before, position });
        if (!result.success || !result.text || view.state.doc.toString() !== before) return null;
        return { pos: position, create: () => { const dom = document.createElement('pre'); dom.style.cssText = 'white-space:pre-wrap;max-width:500px;padding:8px'; dom.textContent = result.text!; return { dom }; } };
      } catch { return null; }
    }),
    linter(async view => {
      const current = context(); if (!lspHandles(current)) return [];
      const before = view.state.doc.toString();
      try {
        const result = await transport({ action: 'diagnostics', root: current.root!, path: current.filePath!, content: before });
        if (view.state.doc.toString() !== before) return [];
        if (!result.success) return [{ from: 0, to: 0, severity: 'info', source: 'language server', message: `Language server: ${result.error}` }];
        return (result.diagnostics || []).map((item): Diagnostic => ({ from: Math.min(item.start, before.length), to: Math.min(Math.max(item.end, item.start), before.length), severity: item.severity, source: item.source || 'language server', message: item.message }));
      } catch { return []; }
    }, { delay: 600 }),
  ];
}

/** Go to definition for the cursor; returns the server's locations in the IDE's shape. */
export async function lspDefinition(context: LspContext, view: EditorView, transport: LspTransport = ipcTransport): Promise<LspResult> {
  return transport({ action: 'definition', root: context.root!, path: context.filePath!, content: view.state.doc.toString(), position: view.state.selection.main.head });
}
