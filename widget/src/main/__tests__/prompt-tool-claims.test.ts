/**
 * The system prompt names tools in prose. Nothing checked those names.
 *
 * system-prompt.ts told every model to "use git tools (git_status, git_log,
 * git_diff, git_branches, git_commit)". git_commit was registered, and the
 * comment above CODING_TOOLS in assistant-bridge.ts said the list covered
 * "read-only + commit" — but the array itself omitted it. So the bridged
 * assistant was told to use a tool it had never been given, and would have
 * failed mid-task on the first commit anyone asked for.
 *
 * Absent is worse than denied: a denied tool produces a permission prompt the
 * user can act on, while a missing one just makes the model improvise.
 *
 * Two invariants, both cheap:
 *   1. Every tool named in the system prompt is a registered tool.
 *   2. Every name in CODING_TOOLS is a registered tool.
 *
 * Deliberately NOT asserted: that prompt-named tools are enabled by default.
 * write_file, edit_file and git_commit all default to false on purpose — the
 * permission gate is the product, not a bug, and the prompt says the user
 * confirms first.
 */

import * as fs from 'fs';
import * as path from 'path';

const srcRoot = path.resolve(__dirname, '..', '..');
const promptSrc = fs.readFileSync(path.join(srcRoot, 'shared', 'system-prompt.ts'), 'utf-8');
const bridgeSrc = fs.readFileSync(path.join(srcRoot, 'main', 'assistant-bridge.ts'), 'utf-8');

/** Every `name: 'x'` across the tool modules — the registry. */
function registeredTools(): Set<string> {
  const dir = path.join(srcRoot, 'main', 'tools');
  const names = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const s = fs.readFileSync(path.join(dir, f), 'utf-8');
    for (const m of s.matchAll(/name: '([a-z0-9_]+)'/g)) names.add(m[1]);
  }
  return names;
}

/**
 * Tool names the prompt names in prose. Only counts snake_case identifiers
 * that are already known tools, so ordinary prose ("run_terminal_command" vs
 * "node_modules") cannot produce a false positive.
 */
function toolsNamedInPrompt(registry: Set<string>): string[] {
  const candidates = promptSrc.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) || [];
  return [...new Set(candidates)].filter(n => registry.has(n));
}

function codingTools(): string[] {
  const block = /export const CODING_TOOLS[\s\S]*?\] as const;/.exec(bridgeSrc)?.[0] ?? '';
  return [...block.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
}

describe('the system prompt only promises tools that exist', () => {
  const registry = registeredTools();

  it('finds the tool registry', () => {
    expect(registry.size).toBeGreaterThan(20);
    expect(registry.has('git_status')).toBe(true);
  });

  it('names a meaningful number of tools in the prompt', () => {
    // Guards the guard: if the extractor silently matched nothing, the
    // invariant below would pass vacuously.
    expect(toolsNamedInPrompt(registry).length).toBeGreaterThanOrEqual(8);
  });

  it('every tool named in the prompt is registered', () => {
    const unknown = toolsNamedInPrompt(registry).filter(n => !registry.has(n));
    expect(unknown).toEqual([]);
  });
});

describe('the assistant bridge exposes only real tools', () => {
  const registry = registeredTools();

  it('finds CODING_TOOLS', () => {
    expect(codingTools().length).toBeGreaterThanOrEqual(10);
  });

  it('every CODING_TOOLS entry is a registered tool', () => {
    // A rename or typo here yields a tool the assistant can never call.
    const unknown = codingTools().filter(n => !registry.has(n));
    expect(unknown).toEqual([]);
  });

  it('the git tools the prompt promises are all reachable through the bridge', () => {
    // The specific regression: the comment claimed commit, the array omitted it.
    const coding = codingTools();
    const promisedGit = toolsNamedInPrompt(registry).filter(n => n.startsWith('git_'));
    expect(promisedGit).toContain('git_commit');
    const missing = promisedGit.filter(n => !coding.includes(n));
    expect(missing).toEqual([]);
  });
});
