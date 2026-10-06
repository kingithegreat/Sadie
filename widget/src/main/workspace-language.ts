import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { validatePath } from './tools/filesystem';
import { homeDir } from './user-paths';
import type { WorkspaceLanguageRequest, WorkspaceLanguageResult, WorkspaceLanguageEdit, WorkspaceLanguageLocation } from '../shared/workspace-language-types';

const MAX_FILES = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_BUFFERS = 100;
const SKIP = new Set(['node_modules', '.git', 'out', 'dist', 'dist-electron', 'build', '.next', '.cache', '.venv', 'venv', 'target']);
const supported = /\.[cm]?[jt]sx?$/i;
const within = (root: string, file: string) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const key = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
function resolveAllowed(input: string): string {
  const result = validatePath(input);
  if (!result.valid) throw new Error(result.error || 'This path is not allowed.');
  const real = fs.realpathSync(result.resolved);
  if (!within(fs.realpathSync(homeDir()), real)) throw new Error('The project must remain inside your home directory, including linked paths.');
  return real;
}

/** No writes, command execution, plugins, or arbitrary tsconfig extensions. */
class LanguageProject {
  readonly root: string;
  readonly library = path.dirname(ts.getDefaultLibFilePath({}));
  readonly service: ts.LanguageService;
  private buffers = new Map<string, string>();
  private files: string[] = [];
  private options: ts.CompilerOptions = {};
  private readBytes = 0;
  private counted = new Set<string>();
  private dependencyRoots: string[] = [];
  constructor(root: string) {
    this.root = root;
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => this.options,
      getScriptFileNames: () => this.files,
      getScriptVersion: file => {
        const buffer = this.buffers.get(key(file));
        if (buffer !== undefined) return buffer;
        try { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; }
      },
      getScriptSnapshot: file => { const text = this.read(file); return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text); },
      getCurrentDirectory: () => this.root,
      getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
      fileExists: file => this.readable(file) && fs.existsSync(file),
      readFile: file => this.read(file),
      readDirectory: (directory, extensions) => this.walk(directory).filter(file => !extensions || extensions.some(ext => file.endsWith(ext))),
      directoryExists: directory => { try { return this.readable(directory) && fs.statSync(directory).isDirectory(); } catch { return false; } },
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => '\n',
      realpath: file => { try { return fs.realpathSync(file); } catch { return file; } },
    };
    this.service = ts.createLanguageService(host);
  }
  private readable(file: string): boolean {
    try {
      const real = fs.realpathSync(file);
      if (within(this.root, real) || within(this.library, real)) return true;
      // Only installed, declared dependencies are read through linked stores.
      // Their contents are never eligible refactoring/edit targets.
      return this.dependencyRoots.some(root => within(root, real)) && (fs.statSync(real).isDirectory() || /\.(?:[cm]?jsx?|tsx?|json)$/i.test(real));
    } catch { return false; }
  }
  private declaredDependencies(): void {
    this.dependencyRoots = [];
    const home = fs.realpathSync(homeDir());
    const visited = new Set<string>();
    let manifestBytes = 0;
    const queue: Array<{ directory: string; depth: number }> = [{ directory: this.root, depth: 0 }];
    while (queue.length && visited.size < 100) {
      const { directory, depth } = queue.shift()!;
      if (depth > 10 || visited.has(key(directory))) continue;
      visited.add(key(directory));
      let manifest: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown>; peerDependencies?: Record<string, unknown> };
      try {
        const file = path.join(directory, 'package.json');
        const size = fs.statSync(file).size;
        if (size > 64 * 1024 || manifestBytes + size > 2 * 1024 * 1024) continue;
        manifestBytes += size;
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch { continue; }
      const names = Object.keys({ ...manifest.dependencies, ...(depth === 0 ? manifest.devDependencies : {}), ...manifest.optionalDependencies, ...manifest.peerDependencies }).slice(0, 100);
      for (const name of names) {
        if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name) || name.split('/').some(part => part === '..' || part === '.')) continue;
        let directoryCandidate = directory;
        while (within(home, directoryCandidate)) {
          const candidate = path.join(directoryCandidate, 'node_modules', name);
          try {
            const real = fs.realpathSync(candidate);
            if (!within(home, real) || !fs.statSync(real).isDirectory()) break;
            if (!this.dependencyRoots.some(root => key(root) === key(real)) && this.dependencyRoots.length < 100) { this.dependencyRoots.push(real); queue.push({ directory: real, depth: depth + 1 }); }
            break;
          } catch { /* Try the parent package store. */ }
          const parent = path.dirname(directoryCandidate); if (parent === directoryCandidate) break; directoryCandidate = parent;
        }
      }
    }
  }
  read(file: string): string | undefined {
    const buffer = this.buffers.get(key(file));
    if (buffer !== undefined) return buffer;
    try {
      const size = fs.statSync(file).size;
      if (!this.readable(file) || size > MAX_BYTES) return undefined;
      if (!this.counted.has(key(file))) { if (this.readBytes + size > 32 * 1024 * 1024) return undefined; this.readBytes += size; this.counted.add(key(file)); }
      return fs.readFileSync(file, 'utf8');
    } catch { return undefined; }
  }
  walk(directory = this.root): string[] {
    const files: string[] = [];
    const visit = (dir: string, depth: number) => {
      if (depth > 30 || files.length >= MAX_FILES || !this.readable(dir)) return;
      let entries: fs.Dirent[]; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        if (entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!SKIP.has(entry.name)) visit(file, depth + 1); }
        else if (entry.isFile()) files.push(file);
      }
    };
    visit(directory, 0); return files;
  }
  update(request: WorkspaceLanguageRequest) {
    this.buffers.clear();
    this.readBytes = 0; this.counted.clear();
    this.declaredDependencies();
    let bufferBytes = 0;
    for (const buffer of [...(request.buffers || []), { path: request.path, content: request.content }]) {
      if (typeof buffer.path !== 'string' || typeof buffer.content !== 'string' || Buffer.byteLength(buffer.content) > MAX_BYTES) throw new Error('An editor buffer exceeds the language-service limit.');
      bufferBytes += Buffer.byteLength(buffer.content);
      if (bufferBytes > 16 * 1024 * 1024) throw new Error('Open buffers exceed the 16 MiB language-context limit. Close large tabs and retry.');
      const file = resolveAllowed(buffer.path);
      if (!within(this.root, file) || !this.readable(file)) throw new Error('Language context must belong to this project.');
      this.buffers.set(key(file), buffer.content);
    }
    this.files = this.walk().filter(file => supported.test(file));
    const config = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(this.root, name)).find(file => fs.existsSync(file));
    this.options = { allowJs: true, checkJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, noEmit: true };
    if (config) {
      const parsed = ts.readConfigFile(config, file => this.read(file));
      if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
      const result = ts.parseJsonConfigFileContent(parsed.config, {
        useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
        fileExists: file => this.readable(file) && fs.existsSync(file), readFile: file => this.read(file),
        readDirectory: () => this.files,
      }, this.root);
      this.options = { ...this.options, ...result.options, noEmit: true };
      this.files = result.fileNames.filter(file => within(this.root, file) && supported.test(file));
    }
    for (const file of this.buffers.keys()) if (supported.test(file) && !this.files.some(existing => key(existing) === file)) this.files.push(file);
  }
  location(file: string, span: ts.TextSpan, name?: string): WorkspaceLanguageLocation | undefined {
    if (!within(this.root, file) || !within(this.root, fs.realpathSync(file))) return undefined;
    const text = this.read(file); if (text === undefined) return undefined;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
    const pos = source.getLineAndCharacterOfPosition(Math.min(span.start, text.length));
    return { path: path.resolve(file), start: span.start, length: span.length, line: pos.line + 1, column: pos.character + 1, name };
  }
  edits(changes: readonly ts.FileTextChanges[]): WorkspaceLanguageEdit[] {
    return changes.map(change => {
      if (change.isNewFile || !within(this.root, change.fileName) || !within(this.root, fs.realpathSync(change.fileName)) || path.relative(this.root, change.fileName).split(path.sep).includes('node_modules')) throw new Error('This action creates files or edits dependencies or files outside this project; use an explicit reviewed edit instead.');
      const content = this.read(change.fileName); if (content === undefined) throw new Error('The refactoring target cannot be read.');
      return { path: path.resolve(change.fileName), expectedContent: content, changes: change.textChanges.map(edit => ({ start: edit.span.start, length: edit.span.length, text: edit.newText })) };
    });
  }
  symbols(): WorkspaceLanguageLocation[] {
    const result: WorkspaceLanguageLocation[] = [];
    const visit = (file: string, item: ts.NavigationTree) => {
      if (result.length >= 500) return;
      const location = item.spans[0] && this.location(file, item.spans[0], item.text);
      if (location && item.kind !== 'module' && item.text !== '<global>') result.push(location);
      for (const child of item.childItems || []) visit(file, child);
    };
    for (const file of this.files) { if (result.length >= 500) break; if (!file.endsWith('.d.ts')) visit(file, this.service.getNavigationTree(file)); }
    return result;
  }
}
const projects = new Map<string, LanguageProject>();
export function disposeWorkspaceLanguageServices(): void { for (const project of projects.values()) project.service.dispose(); projects.clear(); }

export function queryWorkspaceLanguage(request: WorkspaceLanguageRequest): WorkspaceLanguageResult {
  try {
    if (!request || typeof request.root !== 'string' || typeof request.path !== 'string' || typeof request.content !== 'string' || (request.buffers && (!Array.isArray(request.buffers) || request.buffers.length > MAX_BUFFERS))) throw new Error('Invalid language request.');
    const root = resolveAllowed(request.root);
    if (!fs.statSync(root).isDirectory()) throw new Error('Choose a project folder first.');
    const file = resolveAllowed(request.path);
    if (!within(root, file)) throw new Error('The editor file must belong to the displayed project.');
    let project = projects.get(root);
    if (!project) {
      if (projects.size >= 2) { const oldest = projects.keys().next().value as string; projects.get(oldest)?.service.dispose(); projects.delete(oldest); }
      project = new LanguageProject(root); projects.set(root, project);
    }
    if (request.action === 'files') return { success: true, files: project.walk() };
    project.update({ ...request, path: file });
    if (!supported.test(file)) return { success: false, error: 'Semantic navigation and formatting currently support JavaScript and TypeScript projects. Other languages keep syntax highlighting and text editing.' };
    const position = request.position ?? 0;
    if (!Number.isInteger(position) || position < 0 || position > request.content.length) throw new Error('The cursor position is invalid.');
    const service = project.service;
    const locations = (items: readonly { fileName: string; textSpan: ts.TextSpan; name?: string }[] | undefined) => (items || []).map(item => project!.location(item.fileName, item.textSpan, item.name)).filter((item): item is WorkspaceLanguageLocation => !!item).slice(0, 500);
    const format: ts.FormatCodeSettings = { tabSize: request.tabSize === 4 ? 4 : 2, indentSize: request.tabSize === 4 ? 4 : 2, convertTabsToSpaces: true, newLineCharacter: request.content.includes('\r\n') ? '\r\n' : '\n', insertSpaceAfterCommaDelimiter: true, insertSpaceAfterKeywordsInControlFlowStatements: true, insertSpaceBeforeAndAfterBinaryOperators: true };
    switch (request.action) {
      case 'complete': return { success: true, entries: service.getCompletionsAtPosition(file, position, { includeCompletionsForModuleExports: false, includeCompletionsWithInsertText: false })?.entries.slice(0, 250).map(entry => ({ label: entry.name, type: entry.kind })) || [] };
      case 'hover': { const info = service.getQuickInfoAtPosition(file, position); return { success: true, text: info ? [ts.displayPartsToString(info.displayParts), ts.displayPartsToString(info.documentation)].filter(Boolean).join('\n\n') : 'No type information at this position.' }; }
      case 'signature': { const info = service.getSignatureHelpItems(file, position, undefined); return { success: true, text: info?.items.map(item => ts.displayPartsToString(item.prefixDisplayParts) + item.parameters.map(param => ts.displayPartsToString(param.displayParts)).join(ts.displayPartsToString(item.separatorDisplayParts)) + ts.displayPartsToString(item.suffixDisplayParts)).join('\n') || 'No call signature at this position.' }; }
      case 'definition': return { success: true, locations: locations(service.getDefinitionAtPosition(file, position)) };
      case 'references': return { success: true, locations: locations(service.getReferencesAtPosition(file, position)) };
      case 'symbols': return { success: true, locations: project.symbols() };
      case 'diagnostics': return { success: true, diagnostics: [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].slice(0, 200).map(item => ({ start: item.start || 0, length: item.length || 0, severity: item.category === ts.DiagnosticCategory.Error ? 'error' : item.category === ts.DiagnosticCategory.Warning ? 'warning' : 'info', message: ts.flattenDiagnosticMessageText(item.messageText, '\n') })) };
      case 'rename': {
        if (typeof request.newName !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(request.newName)) throw new Error('Enter a valid JavaScript or TypeScript identifier.');
        const info = service.getRenameInfo(file, position);
        if (!info.canRename) throw new Error(info.localizedErrorMessage);
        const grouped = new Map<string, ts.TextChange[]>();
        for (const item of service.findRenameLocations(file, position, false, false, true) || []) {
          const changes = grouped.get(item.fileName) || [];
          changes.push({ span: item.textSpan, newText: (item.prefixText || '') + request.newName + (item.suffixText || '') }); grouped.set(item.fileName, changes);
        }
        return { success: true, edits: project.edits([...grouped].map(([fileName, textChanges]) => ({ fileName, textChanges }))) };
      }
      case 'format': return { success: true, edits: project.edits([{ fileName: file, textChanges: service.getFormattingEditsForDocument(file, format) }]) };
      case 'fixes': {
        const diagnostics = [...service.getSyntacticDiagnostics(file), ...service.getSemanticDiagnostics(file)].filter(item => item.start !== undefined && position >= item.start && position <= item.start + (item.length || 0));
        const fixes = diagnostics.flatMap(item => service.getCodeFixesAtPosition(file, item.start!, item.start! + (item.length || 0), [item.code], format, {}));
        return { success: true, fixes: fixes.slice(0, 20).map(fix => ({ description: fix.description, edits: project!.edits(fix.changes) })) };
      }
      default: throw new Error('Unknown language action.');
    }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
}
