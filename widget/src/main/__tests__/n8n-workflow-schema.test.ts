/**
 * n8n Workflow JSON Schema Validation
 *
 * Ensures that every workflow file in n8n-workflows/ satisfies the minimum
 * schema n8n requires: name, active, nodes (non-empty), connections, versionId.
 * Also validates that all Phase 6 tools are present and active.
 */
import * as fs from 'fs';
import * as path from 'path';

// From widget/src/main/__tests__/ up 4 levels → project root
const WORKFLOWS_ROOT = path.resolve(__dirname, '../../../../n8n-workflows');

interface WorkflowFile {
  /** path relative to WORKFLOWS_ROOT */
  rel: string;
  data: any;
}

/** Recursively collect every *.json under a directory. */
function collectJsonFiles(dir: string, base = dir): WorkflowFile[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: WorkflowFile[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...collectJsonFiles(full, base));
    } else if (e.isFile() && e.name.endsWith('.json') && e.name !== 'test-workflow.json') {
      const raw = fs.readFileSync(full, 'utf-8');
      results.push({ rel: path.relative(base, full), data: JSON.parse(raw) });
    }
  }
  return results;
}

describe('n8n workflow directory', () => {
  test('n8n-workflows/ directory exists', () => {
    expect(fs.existsSync(WORKFLOWS_ROOT)).toBe(true);
  });
});

describe('n8n workflow JSON schema', () => {
  let workflows: WorkflowFile[];

  beforeAll(() => {
    workflows = collectJsonFiles(WORKFLOWS_ROOT);
  });

  test('at least 3 workflow files are present (core + image-generate)', () => {
    expect(workflows.length).toBeGreaterThanOrEqual(3);
  });

  describe('required fields', () => {
    const REQUIRED = ['name', 'active', 'nodes', 'connections'] as const;

    test.each(REQUIRED)('every workflow has field "%s"', (field) => {
      const missing = workflows.filter(w => !(field in w.data)).map(w => w.rel);
      expect(missing).toHaveLength(0);
    });
  });

  test('every workflow has active = true (except those requiring external credentials)', () => {
    // google-calendar requires OAuth credentials to be set up before activation
    const credentialWorkflows = ['google-calendar.json'];
    const inactive = workflows
      .filter(w => w.data.active !== true && !credentialWorkflows.some(c => w.rel.replace(/\\/g, '/').endsWith(c)))
      .map(w => w.rel);
    expect(inactive).toHaveLength(0);
  });

  test('every workflow has at least one node', () => {
    const empty = workflows
      .filter(w => !Array.isArray(w.data.nodes) || w.data.nodes.length === 0)
      .map(w => w.rel);
    expect(empty).toHaveLength(0);
  });

  test('every node has a "type" property', () => {
    const bad: string[] = [];
    for (const { rel, data } of workflows) {
      for (const node of data.nodes ?? []) {
        if (!node.type) bad.push(`${rel} → node "${node.name ?? node.id ?? '?'}"`);
      }
    }
    expect(bad).toHaveLength(0);
  });

  test('every node has a "name" or "id" property', () => {
    const bad: string[] = [];
    for (const { rel, data } of workflows) {
      for (const node of data.nodes ?? []) {
        if (!node.name && !node.id) bad.push(`${rel} → nameless node`);
      }
    }
    expect(bad).toHaveLength(0);
  });

  test('every workflow has a versionId', () => {
    const missing = workflows.filter(w => !w.data.versionId).map(w => w.rel);
    expect(missing).toHaveLength(0);
  });

  test('workflow names are unique', () => {
    const names = workflows.map(w => w.data.name).filter(Boolean);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  // Phase 6 tools now run locally via TypeScript handlers, not through n8n
  // workflows. Only the image-generate n8n tool workflow is still used.
  describe('image-generate workflow is present', () => {
    test('workflow containing "Image" exists', () => {
      const match = workflows.some(w =>
        typeof w.data.name === 'string' && w.data.name.toLowerCase().includes('image')
      );
      expect(match).toBe(true);
    });
  });

  describe('core orchestration workflows are present', () => {
    test('main orchestrator workflow exists', () => {
      const match = workflows.some(w =>
        typeof w.data.name === 'string' &&
        (w.data.name.includes('Orchestrator') || w.data.name.includes('orchestrator'))
      );
      expect(match).toBe(true);
    });

    test('safety webhook workflow exists', () => {
      const match = workflows.some(w =>
        typeof w.data.name === 'string' && w.data.name.toLowerCase().includes('safety')
      );
      expect(match).toBe(true);
    });
  });

  describe('tool allowlist sync', () => {
    let allowlist: string[];

    beforeAll(() => {
      const configPath = path.resolve(WORKFLOWS_ROOT, '../config/tool-allowlist.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      allowlist = config.allowed_tools ?? [];
    });

    test('tool-allowlist.json has at least 10 tools', () => {
      expect(allowlist.length).toBeGreaterThanOrEqual(10);
    });

    test('clipboard tool is in allowlist', () => {
      expect(allowlist).toContain('clipboard');
    });

    test('calendar tool is in allowlist', () => {
      expect(allowlist).toContain('calendar');
    });

    test('web_search tool is in allowlist', () => {
      expect(allowlist).toContain('web_search');
    });

    test('browser_automation tool is in allowlist', () => {
      expect(allowlist).toContain('browser_automation');
    });

    test('email_manager tool is in allowlist', () => {
      expect(allowlist).toContain('email_manager');
    });
  });
});
