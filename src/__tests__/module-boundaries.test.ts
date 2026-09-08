import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface BoundaryViolation {
  from: string;
  to?: string;
  kind: string;
  specifier?: string;
  reason: string;
}

interface BoundaryResult {
  filesChecked: number;
  importEdgesChecked: number;
  internalImportEdges: number;
  unresolvedImportEdges: number;
  violations: BoundaryViolation[];
}

interface BoundaryModule {
  checkModuleBoundaries(options: { repoRoot: string }): BoundaryResult;
}

const boundaries = require('../../scripts/check-module-boundaries.cjs') as BoundaryModule;
const realRepoRoot = path.resolve(__dirname, '..', '..');
let fixtureRoot: string;

function write(relativePath: string, source = 'export const value = true;\n'): void {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source, 'utf8');
}

function checkFixture(): BoundaryResult {
  return boundaries.checkModuleBoundaries({ repoRoot: fixtureRoot });
}

describe('module import boundaries', () => {
  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-module-boundaries-'));
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  test('checks the real production tree with nonzero source and import counts', () => {
    const result = boundaries.checkModuleBoundaries({ repoRoot: realRepoRoot });

    expect(result.filesChecked).toBeGreaterThan(100);
    expect(result.importEdgesChecked).toBeGreaterThan(100);
    expect(result.internalImportEdges).toBeGreaterThan(50);
    expect(result.unresolvedImportEdges).toBe(0);
    expect(result.violations).toEqual([]);
  });

  test('finds static, require, dynamic, and re-export crossings into Studio', () => {
    write('widget/src/main/media-studio.ts');
    write('widget/src/main/core-import.ts', "import './media-studio';\n");
    write('widget/src/main/core-require.ts', "require('./media-studio');\n");
    write('widget/src/main/core-dynamic.ts', "void import('./media-studio');\n");
    write('widget/src/main/core-reexport.ts', "export { value } from './media-studio';\n");

    const result = checkFixture();

    expect(result.filesChecked).toBe(5);
    expect(result.internalImportEdges).toBe(4);
    expect(result.violations.map(violation => violation.kind).sort()).toEqual([
      'dynamic-import', 'export-from', 'import', 'require',
    ]);
    expect(result.violations.every(violation => violation.to === 'widget/src/main/media-studio.ts')).toBe(true);
  });

  test('allows only the approved host, UI, and Studio self-composition directions', () => {
    write('widget/src/main/media-studio.ts', "import './media-render';\n");
    write('widget/src/main/media-render.ts');
    write('widget/src/main/modules/bundled/studio.ts', "import '../../media-studio';\n");
    write('widget/src/renderer/modules/bundled/index.tsx', "void import('../../components/MediaStudioPanel');\n");
    write('widget/src/renderer/components/MediaStudioPanel.tsx');
    write('src/core.ts');
    write('src/service.ts', "export { value } from './core';\n");

    const result = checkFixture();

    expect(result.internalImportEdges).toBe(4);
    expect(result.violations).toEqual([]);
  });

  test('rejects root Core importing any widget runtime file', () => {
    write('src/core.ts', "import '../widget/src/main/config-manager';\n");
    write('widget/src/main/config-manager.ts');

    const result = checkFixture();

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      from: 'src/core.ts',
      to: 'widget/src/main/config-manager.ts',
      kind: 'import',
      reason: 'Root Core cannot import the Electron widget runtime.',
    });
  });

  test('App cannot bypass the registered module UI boundary', () => {
    write('widget/src/renderer/App.tsx', "void import('./components/MediaStudioPanel');\n");
    write('widget/src/renderer/components/MediaStudioPanel.tsx');
    expect(checkFixture().violations).toEqual([expect.objectContaining({
      from: 'widget/src/renderer/App.tsx', to: 'widget/src/renderer/components/MediaStudioPanel.tsx',
    })]);
  });

  test('keeps the existing generic provider exception to its exact path pair', () => {
    write('widget/src/main/movie/comfyui-adapter.ts');
    write('widget/src/main/tools/web.ts', "void import('../movie/comfyui-adapter');\n");
    write('widget/src/main/tools/browser.ts', "void import('../movie/comfyui-adapter');\n");

    const result = checkFixture();

    expect(result.internalImportEdges).toBe(2);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      from: 'widget/src/main/tools/browser.ts',
      to: 'widget/src/main/movie/comfyui-adapter.ts',
      kind: 'dynamic-import',
    });
  });

  test('fails closed when require or dynamic import hides its target', () => {
    write('widget/src/main/core-dynamic.ts', "const target = './media-studio'; void import(target);\n");
    write('widget/src/main/core-require.ts', "const target = './media-studio'; require(target);\n");

    const result = checkFixture();

    expect(result.unresolvedImportEdges).toBe(2);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map(violation => violation.reason)).toEqual([
      'Non-literal dynamic-import cannot be verified against the module boundary.',
      'Non-literal require cannot be verified against the module boundary.',
    ]);
  });

  test('does not scan generated, dependency, or test trees', () => {
    write('src/core.ts');
    write('src/__tests__/forbidden.test.ts', "import '../../widget/src/main/media-studio';\n");
    write('widget/src/node_modules/package/index.ts', "import '../../main/media-studio';\n");
    write('widget/src/out/generated.ts', "import '../main/media-studio';\n");
    write('widget/src/main/media-studio.ts');

    const result = checkFixture();

    expect(result.filesChecked).toBe(2);
    expect(result.importEdgesChecked).toBe(0);
    expect(result.violations).toEqual([]);
  });
});
