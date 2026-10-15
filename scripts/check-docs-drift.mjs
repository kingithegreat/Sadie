#!/usr/bin/env node
/**
 * Docs drift gate for docs/api-reference.md.
 *
 * The reference is hand-written, which is right for the curated parts — the
 * descriptions explain intent in a way generated text never would. But hand
 * maintenance silently fell 39 IPC channels and 102 preload methods behind,
 * and a reference that lists 56 of 158 methods with no indication is worse
 * than one that admits its scope: a reader assumes it is complete.
 *
 * So: prose stays hand-written, and a GENERATED index of the complete surface
 * is kept in sync by this script. Run with --write to regenerate it, without
 * to check (non-zero exit on drift). The check runs as a test, so adding an
 * IPC channel without updating the docs fails the suite instead of rotting.
 *
 *   node scripts/check-docs-drift.mjs          # verify
 *   node scripts/check-docs-drift.mjs --write  # regenerate the index
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', 'api-reference.md');
const PRELOAD = join(ROOT, 'widget', 'src', 'preload', 'index.ts');
const MAIN_DIR = join(ROOT, 'widget', 'src', 'main');

const BEGIN = '<!-- BEGIN GENERATED: surface-index -->';
const END = '<!-- END GENERATED: surface-index -->';

/**
 * Every top-level key of the API exposed as window.electron.
 *
 * The bridge is `exposeInMainWorld('electron', electronAPI …)` — a named
 * object declared earlier, not an inline literal. Scanning forward from the
 * expose call found the NEXT object in the file and reported one method;
 * resolve the identifier back to its declaration instead.
 */
export function extractPreloadMethods(source) {
  const expose = source.match(/exposeInMainWorld\(\s*['"`]electron['"`]\s*,\s*([A-Za-z_$][\w$]*)/);
  const start = expose
    ? source.search(new RegExp(`const\\s+${expose[1]}\\b[^=]*=`))
    : source.indexOf("exposeInMainWorld('electron'");
  if (start === -1) return [];

  // Walk from the opening brace of the object literal to its match, tracking
  // depth so nested objects do not end the scan early.
  const objStart = source.indexOf('{', start);
  let depth = 0;
  let end = objStart;
  for (let i = objStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }

  const body = source.slice(objStart, end);
  const names = new Set();
  // Top-level keys sit at exactly two spaces of indentation in this file.
  for (const m of body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (entry === '__tests__' || entry === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (entry.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Channels main HANDLES (renderer -> main) and channels main SENDS (main -> renderer). */
export function extractChannels(files) {
  const handled = new Set();
  const pushed = new Set();
  const modules = new Map();
  const context = file => {
    if (modules.has(file)) return modules.get(file);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true);
    const result = { source, bindings: new Map(), imports: new Map() };
    modules.set(file, result);
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        // Ambiguous function-local names are deliberately left unresolved.
        result.bindings.set(node.name.text, result.bindings.has(node.name.text) ? null : node.initializer);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        const imported = join(dirname(file), node.moduleSpecifier.text);
        const candidates = [imported + '.ts', join(imported, 'index.ts')];
        const target = candidates.find(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
        if (target && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const binding of node.importClause.namedBindings.elements) result.imports.set(binding.name.text, { file: target, name: binding.propertyName?.text || binding.name.text });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
  };
  const value = (node, module, depth = 0) => {
    if (!node || depth > 16) return undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isParenthesizedExpression(node)) return value(node.expression, module, depth + 1);
    if (ts.isIdentifier(node)) {
      const imported = module.imports.get(node.text);
      if (imported) { const target = context(imported.file); return value(target.bindings.get(imported.name), target, depth + 1); }
      return value(module.bindings.get(node.text), module, depth + 1);
    }
    if (ts.isObjectLiteralExpression(node)) {
      const object = new Map();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isComputedPropertyName(property.name) ? value(property.name.expression, module, depth + 1) : property.name.text;
        object.set(key, value(property.initializer, module, depth + 1));
      }
      return object;
    }
    if (ts.isPropertyAccessExpression(node)) return value(node.expression, module, depth + 1)?.get?.(node.name.text);
    if (ts.isElementAccessExpression(node)) return value(node.expression, module, depth + 1)?.get?.(value(node.argumentExpression, module, depth + 1));
    return undefined;
  };
  for (const file of files) {
    const module = context(file);
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const channel = value(node.arguments[0], module);
        const method = node.expression.name.text;
        if (typeof channel === 'string' && channel.startsWith('homebot:')) {
          if (['handle', 'on'].includes(method) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ipcMain') handled.add(channel);
          else if (method === 'send') pushed.add(channel);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.source);
  }
  // A channel that is both handled and pushed belongs in the handled list.
  for (const c of handled) pushed.delete(c);
  return { handled: [...handled].sort(), pushed: [...pushed].sort() };
}

function buildIndex({ methods, handled, pushed }) {
  const lines = [
    BEGIN,
    '',
    '> Generated by `scripts/check-docs-drift.mjs`. Do not edit by hand —',
    '> `npm run docs:check` fails when this drifts from the source. The curated',
    '> sections above explain the important APIs. The preload list is complete;',
    '> IPC lists resolve literal channels and constant bindings without executing code.',
    '> Dynamically computed registration names require runtime inspection.',
    '',
    `**Preload methods (${methods.length})** — \`window.electron\``,
    '',
    '```',
    ...chunk(methods, 4),
    '```',
    '',
    `**IPC channels, renderer → main (${handled.length})**`,
    '',
    '```',
    ...chunk(handled, 2),
    '```',
    '',
    `**IPC channels, main → renderer (${pushed.length})**`,
    '',
    '```',
    ...chunk(pushed, 2),
    '```',
    '',
    END,
  ];
  return lines.join('\n');
}

/** Fixed-column layout so the diff of a single addition stays small. */
function chunk(items, perLine) {
  const width = Math.max(0, ...items.map(i => i.length)) + 2;
  const rows = [];
  for (let i = 0; i < items.length; i += perLine) {
    rows.push(items.slice(i, i + perLine).map(s => s.padEnd(width)).join('').trimEnd());
  }
  return rows;
}

function main() {
  const write = process.argv.includes('--write');

  const methods = extractPreloadMethods(readFileSync(PRELOAD, 'utf-8'));
  const { handled, pushed } = extractChannels(walk(MAIN_DIR));
  const expected = buildIndex({ methods, handled, pushed });

  // Normalised on read: the index below is generated with \n, but git checks
  // this file out with \r\n on Windows, so a raw comparison reports drift on
  // every fresh checkout. The developer then runs docs:write, gets a diff git
  // normalises away to nothing, and learns to ignore the guard — which is
  // worse than not having one.
  const doc = readFileSync(DOC, 'utf-8').replace(/\r\n/g, '\n');
  const hasBlock = doc.includes(BEGIN) && doc.includes(END);

  const next = hasBlock
    ? doc.slice(0, doc.indexOf(BEGIN)) + expected + doc.slice(doc.indexOf(END) + END.length)
    : `${doc.trimEnd()}\n\n---\n\n## Appendix — Complete surface\n\n${expected}\n`;

  if (write) {
    writeFileSync(DOC, next, 'utf-8');
    console.log(`docs: index regenerated — ${methods.length} preload methods, ${handled.length} R→M, ${pushed.length} M→R`);
    return;
  }

  if (next !== doc) {
    console.error('docs/api-reference.md is out of date with the source.');
    console.error('Run: npm run docs:write');
    process.exit(1);
  }
  console.log(`docs: in sync — ${methods.length} preload methods, ${handled.length} R→M, ${pushed.length} M→R`);
}

// Only run when invoked directly, so the extractors can be unit-tested.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
