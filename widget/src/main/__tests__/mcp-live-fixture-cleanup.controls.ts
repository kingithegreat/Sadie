import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as ts from 'typescript';
import { EventEmitter } from 'events';

/** Exercise the actual native fixture callback with every native call mocked. */
export async function runMcpLiveFixtureCleanupControl(mode: 'primary' | 'cleanup-only' | 'success', assertion: typeof expect) {
  const primary = new Error('Original fixture startup failure'), secondary = new Error('Retained Job cleanup refusal');
  let callback!: () => Promise<void>, closeCalls = 0, removed = false;
  const diagnostics: any[] = [], events = [
    { method: 'fixture/ready', params: { pid: 111 } },
    { method: 'fixture/tree', params: { leafPid: 222, intermediatePid: 333 } },
    { method: 'fixture/ended', params: { code: 0, signal: null } },
  ];
  class HeldChild extends EventEmitter {
    pid = 444; exitCode: number | null = null; signalCode = null; stdout = new EventEmitter();
    kill() { this.exitCode = 0; this.emit('close', 0); return true; }
  }
  const unrelated = new HeldChild();
  const owner = { cleanupScope: 'windows-job', transport: { stderr: new EventEmitter(), onmessage: undefined as undefined | ((message: any) => void),
    async start() { if (mode === 'primary') throw primary; events.forEach(event => owner.transport.onmessage?.(event)); } },
    async close() { closeCalls++; if (mode === 'primary' || (mode === 'cleanup-only' && closeCalls > 1)) throw secondary; } };
  const test = (_name: string, fn: () => Promise<void>) => { callback = fn; }; test.skip = test;
  const file = path.join(__dirname, 'mcp-stdio-owned-live.test.ts');
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const dependencies: Record<string, unknown> = {
    fs: { mkdtempSync: () => 'private-mocked-fixture', writeFileSync() {}, rmSync() { removed = true; } },
    os: { tmpdir: () => 'private-mocked-temp' }, path,
    child_process: { spawn() { Promise.resolve().then(() => unrelated.stdout.emit('data', Buffer.from('UNRELATED_READY'))); return unrelated; } },
    '@modelcontextprotocol/sdk/client/stdio.js': { getDefaultEnvironment: () => ({}) },
    '../mcp-stdio-owned': { createOwnedMcpStdioTransport: () => owner },
    '../workspace-pty-identity': { queryWorkspacePtyIdentity: async () => ({ creation: '123' }), workspacePtyLifecycle: { stopped: async () => closeCalls > 0 } },
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unmocked native fixture dependency: ${name}`); return dependencies[name]; },
    test, expect: assertion, Buffer, setTimeout, clearTimeout, process: { platform: 'win32', env: { HOMEBOT_LIVE_MCP_TREE: '1' }, execPath: 'mocked-node', kill() { return true; } },
    console: { info() {}, error(text: string) { diagnostics.push(JSON.parse(text)); } } });
  let error: unknown;
  try { await callback(); } catch (caught) { error = caught; }
  return { error, primary, secondary, diagnostics, closeCalls, removed, unrelatedClosed: unrelated.exitCode === 0 };
}
