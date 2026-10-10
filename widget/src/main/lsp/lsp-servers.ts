/**
 * Language-server registry. Adding a server is a config entry: which file
 * extensions it handles and how to find it (an npm package script run with
 * HomeBot's bundled Node, or a binary on PATH). Pyright is enabled first;
 * gopls and rust-analyzer are listed as examples and stay disabled until
 * they are verified end to end.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { workspacePathWithin } from '../workspace-trust';

export interface LanguageServerConfig {
  id: string;
  label: string;
  languageId: string;
  extensions: string[];
  enabled: boolean;
  /** npm package whose script speaks LSP over stdio (run with HomeBot's Node, no shell). */
  npm?: { name: string; script: string; args: string[]; installSpec: string };
  /** Executable on PATH. */
  binary?: { name: string; args: string[] };
  initializationOptions?: unknown;
}

export const LANGUAGE_SERVERS: LanguageServerConfig[] = [
  { id: 'pyright', label: 'Pyright (Python)', languageId: 'python', extensions: ['.py', '.pyi'], enabled: true,
    npm: { name: 'pyright', script: 'langserver.index.js', args: ['--stdio'], installSpec: 'pyright@^1.1.400' },
    binary: { name: 'pyright-langserver', args: ['--stdio'] } },
  { id: 'gopls', label: 'gopls (Go)', languageId: 'go', extensions: ['.go'], enabled: false, binary: { name: 'gopls', args: [] } },
  { id: 'rust-analyzer', label: 'rust-analyzer (Rust)', languageId: 'rust', extensions: ['.rs'], enabled: false, binary: { name: 'rust-analyzer', args: [] } },
];

export function serverForFile(file: string, servers = LANGUAGE_SERVERS): LanguageServerConfig | undefined {
  const extension = path.extname(file).toLowerCase();
  return servers.find(server => server.enabled && server.extensions.includes(extension));
}

export const homebotServersDir = () => path.join(app.getPath('userData'), 'language-servers');

export interface ResolvedServer { command: string; args: string[]; env: NodeJS.ProcessEnv; source: 'project' | 'homebot' | 'path'; version?: string }

function npmScript(base: string, config: NonNullable<LanguageServerConfig['npm']>, mustStayWithin?: string): { script: string; version?: string } | null {
  try {
    const directory = path.join(base, 'node_modules', config.name);
    const script = fs.realpathSync(path.join(directory, config.script));
    if (mustStayWithin && !workspacePathWithin(mustStayWithin, script)) return null;
    let version: string | undefined; try { version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version; } catch { /* unknown */ }
    return { script, version };
  } catch { return null; }
}
const nodeEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' });

function onPath(name: string, env = process.env): string | null {
  const directories = (env.Path || env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const directory of directories) for (const candidate of names) {
    const file = path.join(directory.replace(/^"|"$/g, ''), candidate);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* keep looking */ }
  }
  return null;
}

/** Project install first, then HomeBot's own install, then PATH. */
export function resolveLanguageServer(root: string, config: LanguageServerConfig): ResolvedServer | null {
  if (config.npm) {
    const project = npmScript(root, config.npm, root);
    if (project) return { command: process.execPath, args: [project.script, ...config.npm.args], env: nodeEnv(), source: 'project', version: project.version };
    const own = npmScript(homebotServersDir(), config.npm);
    if (own) return { command: process.execPath, args: [own.script, ...config.npm.args], env: nodeEnv(), source: 'homebot', version: own.version };
  }
  if (config.binary) {
    const found = onPath(config.binary.name);
    if (found) {
      // npm global shims (.cmd / shell scripts) are run as their package script, never through a shell.
      if (config.npm && (/\.cmd$/i.test(found) || process.platform !== 'win32')) {
        const viaShim = npmScript(path.dirname(found), config.npm) || npmScript(path.join(path.dirname(found), '..', 'lib'), config.npm);
        if (viaShim) return { command: process.execPath, args: [viaShim.script, ...config.npm.args], env: nodeEnv(), source: 'path', version: viaShim.version };
        if (/\.cmd$/i.test(found)) return null;
      }
      return { command: found, args: config.binary.args, env: { ...process.env }, source: 'path' };
    }
  }
  return null;
}
