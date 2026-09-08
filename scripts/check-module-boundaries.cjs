#!/usr/bin/env node
/**
 * Core / Production Studio import-boundary guard.
 *
 * Core may compose Studio only through widget/src/main/modules/bundled/**.
 * The renderer composes compiled module views under renderer/modules/bundled/.
 * Studio may import Core services and other Studio files.
 * Root src/ is platform-neutral Core and must never import widget/src runtime.
 *
 * This scanner uses the TypeScript AST so comments and string contents cannot
 * look like imports, while import declarations, export-from declarations,
 * require(), dynamic import(), import-equals and import types are all covered.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SOURCE_ROOTS = ['src', 'widget/src'];
const SOURCE_EXTENSION_RE = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_FILE_RE = /(?:^|\/)(?:__tests__|e2e)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/i;
const IGNORED_DIRECTORIES = new Set([
  '.git', '.kilo', 'node_modules', 'out', 'dist', 'coverage', 'test-results', 'playwright-report',
]);

// Temporary provider reuse exception; UI composition is owned by bundled modules.
const EXACT_EXCEPTIONS = new Map([
  [
    'widget/src/main/tools/web.ts\0widget/src/main/movie/comfyui-adapter.ts',
    'Existing generic image tool reuses the local ComfyUI implementation; migrate behind a Core provider contract.',
  ],
]);

function slash(value) {
  return value.replace(/\\/g, '/');
}

function repoRelative(repoRoot, filePath) {
  return slash(path.relative(repoRoot, filePath));
}

function isSourceFile(filePath) {
  const normalized = slash(filePath);
  return SOURCE_EXTENSION_RE.test(normalized) && !TEST_FILE_RE.test(normalized);
}

function listSourceFiles(repoRoot, sourceRoots = SOURCE_ROOTS) {
  const files = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && isSourceFile(target)) files.push(path.resolve(target));
    }
  };
  for (const sourceRoot of sourceRoots) walk(path.resolve(repoRoot, sourceRoot));
  return files.sort((a, b) => slash(a).localeCompare(slash(b)));
}

function literalSpecifier(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function scanFileImports(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const scriptKind = /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX
      : /\.(?:ts|mts|cts)$/i.test(filePath) ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const imports = [];

  const add = (kind, specifierNode) => {
    const specifier = literalSpecifier(specifierNode);
    const position = sourceFile.getLineAndCharacterOfPosition(specifierNode.getStart(sourceFile));
    imports.push({
      kind,
      specifier,
      expression: specifierNode.getText(sourceFile),
      line: position.line + 1,
      column: position.character + 1,
    });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      add('import', node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add('export-from', node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression) {
      add('import-equals', node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)) {
      add('import-type', node.argument.literal);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add('dynamic-import', node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add('require', node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function resolveImportTarget(fromFile, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const rawTarget = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [rawTarget];
  if (!path.extname(rawTarget)) {
    for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
      candidates.push(rawTarget + extension);
    }
    for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
      candidates.push(path.join(rawTarget, 'index' + extension));
    }
  } else if (/\.[cm]?jsx?$/i.test(rawTarget)) {
    const withoutExtension = rawTarget.slice(0, -path.extname(rawTarget).length);
    candidates.push(withoutExtension + '.ts', withoutExtension + '.tsx');
  }
  return path.resolve(candidates.find(candidate => fs.existsSync(candidate)) || rawTarget);
}

function isStudioImplementation(relativePath) {
  const file = slash(relativePath);
  return /^widget\/src\/main\/media-[^/]+\.[cm]?[jt]sx?$/i.test(file)
    || /^widget\/src\/main\/movie\//i.test(file)
    || /^widget\/src\/main\/tools\/(?:media(?:-[^/]+)?|narrate-clip|character-sprites)\.[cm]?[jt]sx?$/i.test(file)
    || /^widget\/src\/main\/(?:ancient-pathways)\.[cm]?[jt]sx?$/i.test(file)
    || /^widget\/src\/renderer\/components\/(?:MediaStudio[^/]*\.[cm]?[jt]sx?|media-studio\/)/i.test(file);
}

function isBundledComposition(relativePath) {
  return /^widget\/src\/(?:main|renderer)\/modules\/bundled\//.test(slash(relativePath));
}

function exceptionReason(from, to) {
  if (isBundledComposition(from)) {
    return 'Approved trusted bundled-module composition adapter.';
  }
  return EXACT_EXCEPTIONS.get(`${slash(from)}\0${slash(to)}`);
}

function boundaryViolation(from, to) {
  const source = slash(from);
  const target = slash(to);
  if (source.startsWith('src/') && target.startsWith('widget/src/')) {
    return 'Root Core cannot import the Electron widget runtime.';
  }
  if (!isStudioImplementation(source) && isStudioImplementation(target)) {
    if (exceptionReason(source, target)) return undefined;
    return 'Core cannot import Production Studio implementation outside an approved composition adapter.';
  }
  return undefined;
}

function checkModuleBoundaries(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const files = options.files
    ? options.files.map(file => path.resolve(repoRoot, file)).filter(isSourceFile)
    : listSourceFiles(repoRoot, options.sourceRoots || SOURCE_ROOTS);
  const edges = [];
  const violations = [];
  let internalImportEdges = 0;
  let unresolvedImportEdges = 0;

  for (const fromFile of files) {
    const from = repoRelative(repoRoot, fromFile);
    for (const imported of scanFileImports(fromFile)) {
      if (imported.specifier === undefined) {
        unresolvedImportEdges += 1;
        const edge = { from, to: undefined, internal: false, ...imported };
        edges.push(edge);
        violations.push({
          ...edge,
          reason: `Non-literal ${imported.kind} cannot be verified against the module boundary.`,
        });
        continue;
      }
      const targetPath = resolveImportTarget(fromFile, imported.specifier);
      const to = targetPath ? repoRelative(repoRoot, targetPath) : undefined;
      const internal = !!to && !to.startsWith('../') && !path.isAbsolute(to);
      const edge = { from, to, internal, ...imported };
      edges.push(edge);
      if (!internal || !to) continue;
      internalImportEdges += 1;
      const reason = boundaryViolation(from, to);
      if (reason) violations.push({ ...edge, reason });
    }
  }

  return {
    repoRoot,
    filesChecked: files.length,
    importEdgesChecked: edges.length,
    internalImportEdges,
    unresolvedImportEdges,
    edges,
    violations,
  };
}

function formatViolation(violation) {
  return `${violation.from}:${violation.line}:${violation.column} `
    + `[${violation.kind}] ${violation.specifier ?? violation.expression}`
    + `${violation.to ? ` -> ${violation.to}` : ''}: ${violation.reason}`;
}

function main() {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  const result = checkModuleBoundaries({ repoRoot });
  console.log(
    `[module-boundaries] Checked ${result.filesChecked} production source files, `
    + `${result.importEdgesChecked} import edges (${result.internalImportEdges} internal, `
    + `${result.unresolvedImportEdges} non-literal).`,
  );
  if (!result.violations.length) {
    console.log('[module-boundaries] No forbidden Core-to-Studio or root-Core-to-widget imports found.');
    return;
  }
  console.error(`[module-boundaries] Found ${result.violations.length} forbidden import(s):`);
  for (const violation of result.violations) console.error(`  ${formatViolation(violation)}`);
  process.exitCode = 1;
}

module.exports = {
  EXACT_EXCEPTIONS,
  boundaryViolation,
  checkModuleBoundaries,
  formatViolation,
  isStudioImplementation,
  listSourceFiles,
  scanFileImports,
};

if (require.main === module) main();
