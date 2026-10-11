/**
 * Minimal JSON-RPC 2.0 over stdio with LSP Content-Length framing. Reusable for
 * any language server; it knows nothing about Python.
 */
import type { ChildProcessWithoutNullStreams } from 'child_process';

export interface LspConnectionOptions { requestTimeoutMs?: number; onNotification?: (method: string, params: any) => void; onExit?: (code: number | null) => void }
export class LspConnection {
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private closed = false;
  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly options: LspConnectionOptions = {}) {
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr.on('data', () => { /* servers log to stderr; ignored */ });
    child.on('exit', code => this.close(new Error(`The language server exited (${code ?? 'signal'}).`), code));
    child.on('error', error => this.close(error, null));
  }
  get isClosed(): boolean { return this.closed; }
  private close(error: Error, code: number | null): void {
    if (this.closed) return; this.closed = true;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear(); this.options.onExit?.(code);
  }
  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n'); if (headerEnd < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
      if (!Number.isFinite(length) || length > 64 * 1024 * 1024) { this.child.kill(); return; }
      if (this.buffer.length < headerEnd + 4 + length) return;
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
      this.buffer = this.buffer.subarray(headerEnd + 4 + length);
      let message: any; try { message = JSON.parse(body); } catch { continue; }
      if (message.id !== undefined && message.method === undefined) {
        const entry = this.pending.get(message.id); if (!entry) continue;
        this.pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message || 'Language server error.')); else entry.resolve(message.result);
      } else if (message.method && message.id !== undefined) {
        // Server-to-client requests: answer conservatively so servers never wait.
        const result = message.method === 'workspace/configuration' ? (message.params?.items || []).map(() => null) : null;
        this.write({ jsonrpc: '2.0', id: message.id, result });
      } else if (message.method) this.options.onNotification?.(message.method, message.params);
    }
  }
  private write(message: unknown): void {
    if (this.closed) return;
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]));
  }
  request<T = any>(method: string, params: unknown, timeoutMs = this.options.requestTimeoutMs ?? 5000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('The language server is not running.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } }); reject(new Error(`The language server did not answer ${method} within ${timeoutMs} ms.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method: string, params: unknown): void { this.write({ jsonrpc: '2.0', method, params }); }
  dispose(): void {
    if (this.closed) return;
    void this.request('shutdown', null, 1000).catch(() => undefined).finally(() => { this.notify('exit', null); setTimeout(() => { if (!this.child.killed) this.child.kill(); }, 500).unref?.(); });
  }
}
