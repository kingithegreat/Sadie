import { ModuleContractError, ModuleManifestV1, ModuleVersionRangeV1 } from './contracts';

const moduleIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function invalid(field: string): never {
  throw new ModuleContractError('INVALID_MANIFEST', `Invalid module manifest field: ${field}.`, field);
}

function object(value: unknown, field: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) invalid(field);
  const result = value as Record<string, unknown>;
  if (required.some(key => !Object.prototype.hasOwnProperty.call(result, key))) invalid(field);
  if (Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))) invalid(field);
  return result;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) invalid(field);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(field);
  return value;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 256) invalid(field);
  const result = value.map(item => text(item, field));
  if (new Set(result).size !== result.length) invalid(field);
  return result;
}

function release(value: unknown, field: string): string {
  const result = text(value, field);
  if (!releasePattern.test(result) || result.split('.').some(n => !Number.isSafeInteger(Number(n)))) invalid(field);
  return result;
}

function compare(a: string, b: string): number {
  const aa = a.split('.').map(Number);
  const bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] < bb[i] ? -1 : 1;
  return 0;
}

export function moduleVersionFits(version: string, range: ModuleVersionRangeV1): boolean {
  // Callers can use this on untrusted data too; malformed releases never compare as compatible.
  try {
    release(version, 'version');
    const bounds = versionRange(range, 'range');
    return compare(version, bounds.min) >= 0 && compare(version, bounds.maxExclusive) < 0;
  } catch { return false; }
}

function versionRange(value: unknown, field: string): ModuleVersionRangeV1 {
  const data = object(value, field, ['min', 'maxExclusive']);
  const min = release(data.min, `${field}.min`);
  const maxExclusive = release(data.maxExclusive, `${field}.maxExclusive`);
  if (compare(min, maxExclusive) >= 0) invalid(field);
  return { min, maxExclusive };
}

function freezeData<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}

/** Strict validation plus a detached immutable copy; no executable paths or credentials. */
export function parseModuleManifest(value: unknown): ModuleManifestV1 {
  const data = object(value, 'manifest', [
    'schemaVersion', 'id', 'publisher', 'version', 'hostApi', 'display', 'platforms',
    'dependencies', 'optionalIntegrations', 'contributions', 'permissions', 'grants', 'resources', 'dataSchemaVersion',
  ]);
  if (data.schemaVersion !== 1) invalid('schemaVersion');
  const id = text(data.id, 'id');
  if (!moduleIdPattern.test(id)) invalid('id');
  const display = object(data.display, 'display', ['name', 'description']);
  const platforms = strings(data.platforms, 'platforms');
  if (!platforms.length || platforms.some(p => !['win32', 'darwin', 'linux'].includes(p))) invalid('platforms');
  if (!Array.isArray(data.dependencies) || data.dependencies.length > 64) invalid('dependencies');
  const dependencies = data.dependencies.map((dep, index) => {
    const field = `dependencies.${index}`;
    const item = object(dep, field, ['id', 'version']);
    const depId = text(item.id, `${field}.id`);
    if (!moduleIdPattern.test(depId) || depId === id) invalid(`${field}.id`);
    return { id: depId, version: versionRange(item.version, `${field}.version`) };
  });
  if (new Set(dependencies.map(dep => dep.id)).size !== dependencies.length) invalid('dependencies');
  const contributions = object(data.contributions, 'contributions', ['commands', 'views', 'settings', 'providers']);
  const names = (kind: string): string[] => {
    const result = strings(contributions[kind], `contributions.${kind}`);
    if (result.some(name => !name.startsWith(`${id}.`) || !/^[a-z][a-z0-9_.-]+$/.test(name))) invalid(`contributions.${kind}`);
    return result;
  };
  const resources = object(data.resources, 'resources', ['gpu'], ['estimatedMemoryMb']);
  if (!['none', 'optional', 'required'].includes(resources.gpu as string)) invalid('resources.gpu');
  return freezeData({
    schemaVersion: 1, id, publisher: text(data.publisher, 'publisher'), version: release(data.version, 'version'),
    hostApi: versionRange(data.hostApi, 'hostApi'),
    display: { name: text(display.name, 'display.name'), description: text(display.description, 'display.description') },
    platforms: platforms as ModuleManifestV1['platforms'], dependencies,
    optionalIntegrations: strings(data.optionalIntegrations, 'optionalIntegrations'),
    contributions: { commands: names('commands'), views: names('views'), settings: names('settings'), providers: names('providers') },
    permissions: strings(data.permissions, 'permissions'), grants: strings(data.grants, 'grants'),
    resources: {
      gpu: resources.gpu as ModuleManifestV1['resources']['gpu'],
      ...(resources.estimatedMemoryMb === undefined ? {} : { estimatedMemoryMb: integer(resources.estimatedMemoryMb, 'resources.estimatedMemoryMb') }),
    },
    dataSchemaVersion: integer(data.dataSchemaVersion, 'dataSchemaVersion'),
  });
}
