import { ModuleContractError, ModuleManifestV1 } from '../modules/contracts';
import { moduleVersionFits, parseModuleManifest } from '../modules/manifest';

function validManifest(): ModuleManifestV1 {
  return {
    schemaVersion: 1,
    id: 'homebot.media-studio',
    publisher: 'HomeBot',
    version: '1.10.0',
    hostApi: { min: '1.0.0', maxExclusive: '2.0.0' },
    display: { name: 'Media Studio', description: 'Creates reviewed media projects.' },
    platforms: ['win32', 'darwin', 'linux'],
    dependencies: [
      { id: 'homebot.core-media', version: { min: '1.2.0', maxExclusive: '1.11.0' } },
    ],
    optionalIntegrations: ['ffmpeg', 'kokoro'],
    contributions: {
      commands: ['homebot.media-studio.render'],
      views: ['homebot.media-studio.workspace'],
      settings: ['homebot.media-studio.preferences'],
      providers: ['homebot.media-studio.local-renderer'],
    },
    permissions: ['media.read', 'media.write'],
    grants: ['studio.enabled'],
    resources: { gpu: 'optional', estimatedMemoryMb: 2048 },
    dataSchemaVersion: 1,
  };
}

function cloneManifest(): ModuleManifestV1 {
  return JSON.parse(JSON.stringify(validManifest())) as ModuleManifestV1;
}

function expectInvalid(value: unknown, field?: string): void {
  let thrown: unknown;
  try {
    parseModuleManifest(value);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ModuleContractError);
  expect((thrown as ModuleContractError).code).toBe('INVALID_MANIFEST');
  if (field) expect((thrown as ModuleContractError).field).toBe(field);
}

function assertDeeplyFrozen(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  Object.values(value).forEach(assertDeeplyFrozen);
}

describe('module manifest v1', () => {
  test('accepts the complete v1 data contract', () => {
    const input = validManifest();

    expect(parseModuleManifest(input)).toEqual(input);
  });

  test.each([
    ['top-level trusted flag', (value: Record<string, unknown>) => { value.trusted = true; }, 'manifest'],
    ['top-level entrypoint', (value: Record<string, unknown>) => { value.entrypoint = './activate.js'; }, 'manifest'],
    ['top-level API key', (value: Record<string, unknown>) => { value.apiKey = 'secret'; }, 'manifest'],
    ['host API range', (value: Record<string, unknown>) => { (value.hostApi as Record<string, unknown>).trusted = true; }, 'hostApi'],
    ['display', (value: Record<string, unknown>) => { (value.display as Record<string, unknown>).entrypoint = 'run'; }, 'display'],
    ['dependency', (value: Record<string, unknown>) => {
      ((value.dependencies as Array<Record<string, unknown>>)[0]).apiKey = 'secret';
    }, 'dependencies.0'],
    ['dependency range', (value: Record<string, unknown>) => {
      const dependency = (value.dependencies as Array<Record<string, unknown>>)[0];
      (dependency.version as Record<string, unknown>).trusted = true;
    }, 'dependencies.0.version'],
    ['contributions', (value: Record<string, unknown>) => {
      (value.contributions as Record<string, unknown>).entrypoint = './run.js';
    }, 'contributions'],
    ['resources', (value: Record<string, unknown>) => {
      (value.resources as Record<string, unknown>).apiKey = 'secret';
    }, 'resources'],
  ])('rejects an unknown field at the %s level', (_label, mutate, field) => {
    const candidate = cloneManifest() as unknown as Record<string, unknown>;
    mutate(candidate);
    expectInvalid(candidate, field);
  });

  test('does not evaluate an unknown executable field', () => {
    const candidate = validManifest() as ModuleManifestV1 & { entrypoint?: unknown };
    const entrypoint = jest.fn(() => './activate.js');
    Object.defineProperty(candidate, 'entrypoint', { enumerable: true, get: entrypoint });

    expectInvalid(candidate, 'manifest');
    expect(entrypoint).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong schema version', (value: Record<string, unknown>) => { value.schemaVersion = 2; }, 'schemaVersion'],
    ['missing required field', (value: Record<string, unknown>) => { delete value.publisher; }, 'manifest'],
    ['array as manifest', () => {}, 'manifest'],
    ['invalid module id', (value: Record<string, unknown>) => { value.id = 'MediaStudio'; }, 'id'],
    ['blank publisher', (value: Record<string, unknown>) => { value.publisher = '   '; }, 'publisher'],
    ['overlong text', (value: Record<string, unknown>) => { value.publisher = 'x'.repeat(513); }, 'publisher'],
    ['missing display value', (value: Record<string, unknown>) => {
      delete (value.display as Record<string, unknown>).description;
    }, 'display'],
    ['non-array dependencies', (value: Record<string, unknown>) => { value.dependencies = {}; }, 'dependencies'],
    ['too many dependencies', (value: Record<string, unknown>) => {
      value.dependencies = Array.from({ length: 65 }, (_, index) => ({
        id: `homebot.dependency-${index}`,
        version: { min: '1.0.0', maxExclusive: '2.0.0' },
      }));
    }, 'dependencies'],
    ['self dependency', (value: Record<string, unknown>) => {
      ((value.dependencies as Array<Record<string, unknown>>)[0]).id = value.id;
    }, 'dependencies.0.id'],
    ['duplicate dependency', (value: Record<string, unknown>) => {
      const dependency = (value.dependencies as Array<Record<string, unknown>>)[0];
      value.dependencies = [dependency, JSON.parse(JSON.stringify(dependency)) as Record<string, unknown>];
    }, 'dependencies'],
    ['empty platforms', (value: Record<string, unknown>) => { value.platforms = []; }, 'platforms'],
    ['unknown platform', (value: Record<string, unknown>) => { value.platforms = ['win32', 'android']; }, 'platforms'],
    ['duplicate platform', (value: Record<string, unknown>) => { value.platforms = ['win32', 'win32']; }, 'platforms'],
    ['invalid GPU request', (value: Record<string, unknown>) => {
      (value.resources as Record<string, unknown>).gpu = 'always';
    }, 'resources.gpu'],
    ['zero memory request', (value: Record<string, unknown>) => {
      (value.resources as Record<string, unknown>).estimatedMemoryMb = 0;
    }, 'resources.estimatedMemoryMb'],
    ['fractional memory request', (value: Record<string, unknown>) => {
      (value.resources as Record<string, unknown>).estimatedMemoryMb = 1.5;
    }, 'resources.estimatedMemoryMb'],
    ['unsafe memory request', (value: Record<string, unknown>) => {
      (value.resources as Record<string, unknown>).estimatedMemoryMb = Number.MAX_SAFE_INTEGER + 1;
    }, 'resources.estimatedMemoryMb'],
    ['invalid data schema version', (value: Record<string, unknown>) => { value.dataSchemaVersion = 0; }, 'dataSchemaVersion'],
    ['non-integer data schema version', (value: Record<string, unknown>) => { value.dataSchemaVersion = 1.5; }, 'dataSchemaVersion'],
  ])('rejects invalid type or bound: %s', (label, mutate, field) => {
    const candidate: unknown = label === 'array as manifest'
      ? []
      : cloneManifest() as unknown as Record<string, unknown>;
    mutate(candidate as Record<string, unknown>);
    expectInvalid(candidate, field);
  });

  test.each([
    ['optionalIntegrations', 'ffmpeg'],
    ['permissions', 'media.read'],
    ['grants', 'studio.enabled'],
  ])('rejects duplicate %s entries', (field, duplicate) => {
    const candidate = cloneManifest() as unknown as Record<string, unknown>;
    candidate[field] = [duplicate, duplicate];
    expectInvalid(candidate, field);
  });

  test.each(['commands', 'views', 'settings', 'providers'])('rejects duplicate %s namespace entries', kind => {
    const candidate = cloneManifest();
    const namespace = `homebot.media-studio.duplicate-${kind}`;
    candidate.contributions[kind as keyof ModuleManifestV1['contributions']] = [namespace, namespace];

    expectInvalid(candidate, `contributions.${kind}`);
  });

  test.each([
    ['foreign namespace', 'other.module.render'],
    ['uppercase name', 'homebot.media-studio.Render'],
    ['bare module namespace', 'homebot.media-studio'],
  ])('rejects an invalid contribution namespace: %s', (_label, name) => {
    const candidate = cloneManifest();
    candidate.contributions.commands = [name];
    expectInvalid(candidate, 'contributions.commands');
  });

  test('enforces the 256-entry list bound and item types', () => {
    const tooMany = cloneManifest();
    tooMany.optionalIntegrations = Array.from({ length: 257 }, (_, index) => `integration-${index}`);
    expectInvalid(tooMany, 'optionalIntegrations');

    const nonText = cloneManifest() as unknown as Record<string, unknown>;
    nonText.permissions = ['media.read', 7];
    expectInvalid(nonText, 'permissions');
  });

  test('returns a detached, deeply frozen copy', () => {
    const input = validManifest();
    const parsed = parseModuleManifest(input);

    expect(parsed).not.toBe(input);
    expect(parsed.display).not.toBe(input.display);
    expect(parsed.hostApi).not.toBe(input.hostApi);
    expect(parsed.dependencies[0]).not.toBe(input.dependencies[0]);
    expect(parsed.dependencies[0].version).not.toBe(input.dependencies[0].version);
    expect(parsed.contributions).not.toBe(input.contributions);
    expect(parsed.resources).not.toBe(input.resources);
    assertDeeplyFrozen(parsed);

    input.display.name = 'Changed';
    input.dependencies[0].version.min = '1.9.0';
    input.contributions.commands.push('homebot.media-studio.changed');
    input.platforms.length = 0;

    expect(parsed.display.name).toBe('Media Studio');
    expect(parsed.dependencies[0].version.min).toBe('1.2.0');
    expect(parsed.contributions.commands).toEqual(['homebot.media-studio.render']);
    expect(parsed.platforms).toEqual(['win32', 'darwin', 'linux']);
    expect(() => parsed.contributions.commands.push('homebot.media-studio.changed')).toThrow(TypeError);
  });
});

describe('module version compatibility', () => {
  test.each([
    { version: '1.2.0', min: '1.2.0', maxExclusive: '2.0.0', expected: true, label: 'minimum is inclusive' },
    { version: '1.9.9', min: '1.2.0', maxExclusive: '2.0.0', expected: true, label: 'interior release' },
    { version: '2.0.0', min: '1.2.0', maxExclusive: '2.0.0', expected: false, label: 'maximum is exclusive' },
    { version: '1.1.9', min: '1.2.0', maxExclusive: '2.0.0', expected: false, label: 'below minimum' },
    { version: '1.10.0', min: '1.2.0', maxExclusive: '1.11.0', expected: true, label: 'numeric segment ordering' },
    { version: '1.2.0', min: '1.10.0', maxExclusive: '2.0.0', expected: false, label: 'numeric minimum ordering' },
  ])('$label: $version in [$min, $maxExclusive)', ({ version, min, maxExclusive, expected }) => {
    expect(moduleVersionFits(version, { min, maxExclusive })).toBe(expected);
  });

  test.each([
    'v1.0.0',
    '1.0',
    '1.0.0-beta.1',
    '1.0.0+build.1',
    '01.0.0',
    '1.02.0',
    '1.0.00',
    ' 1.0.0',
    '1.0.0.0',
    '9007199254740992.0.0',
  ])('rejects invalid or non-release version %s', version => {
    expect(moduleVersionFits(version, { min: '1.0.0', maxExclusive: '2.0.0' })).toBe(false);

    const candidate = validManifest();
    candidate.version = version;
    expectInvalid(candidate, 'version');
  });

  test.each([
    ['missing bound', { min: '1.0.0' }],
    ['unknown range field', { min: '1.0.0', maxExclusive: '2.0.0', trusted: true }],
    ['prerelease bound', { min: '1.0.0-beta.1', maxExclusive: '2.0.0' }],
    ['leading-zero bound', { min: '01.0.0', maxExclusive: '2.0.0' }],
    ['empty range', { min: '2.0.0', maxExclusive: '2.0.0' }],
    ['reversed range', { min: '2.0.0', maxExclusive: '1.0.0' }],
  ])('rejects an invalid explicit range: %s', (_label, range) => {
    expect(moduleVersionFits('1.5.0', range as { min: string; maxExclusive: string })).toBe(false);
  });

  test('validates both host and dependency ranges when parsing', () => {
    const host = validManifest();
    host.hostApi = { min: '2.0.0', maxExclusive: '2.0.0' };
    expectInvalid(host, 'hostApi');

    const dependency = validManifest();
    dependency.dependencies[0].version = { min: '1.0.0-beta.1', maxExclusive: '2.0.0' };
    expectInvalid(dependency, 'dependencies.0.version.min');
  });
});
