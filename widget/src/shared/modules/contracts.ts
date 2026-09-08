/** Data-only contracts for reviewed, bundled modules. A manifest cannot grant trust. */
export const MODULE_HOST_API_VERSION = '1.0.0';

/** Stable releases only in v1; both bounds are explicit, with an exclusive upper bound. */
export interface ModuleVersionRangeV1 { min: string; maxExclusive: string }

export interface ModuleManifestV1 {
  schemaVersion: 1;
  id: string;
  publisher: string;
  version: string;
  hostApi: ModuleVersionRangeV1;
  display: { name: string; description: string };
  platforms: Array<'win32' | 'darwin' | 'linux'>;
  dependencies: Array<{ id: string; version: ModuleVersionRangeV1 }>;
  optionalIntegrations: string[];
  contributions: { commands: string[]; views: string[]; settings: string[]; providers: string[] };
  /** Requests only. Existing Core permission and license checks remain authoritative. */
  permissions: string[];
  grants: string[];
  resources: { gpu: 'none' | 'optional' | 'required'; estimatedMemoryMb?: number };
  dataSchemaVersion: number;
}

export type ModuleRuntimeStateV1 = 'disabled' | 'enabling' | 'enabled' | 'draining' | 'failed';
export type ModuleFailureCodeV1 =
  | 'INVALID_MANIFEST' | 'DUPLICATE_MODULE' | 'INCOMPATIBLE_HOST' | 'UNSUPPORTED_PLATFORM'
  | 'DEPENDENCY_MISSING' | 'DEPENDENCY_INCOMPATIBLE' | 'DEPENDENCY_CYCLE' | 'DEPENDENCY_DISABLED'
  | 'ACTIVE_DEPENDENTS' | 'MODULE_UNAVAILABLE' | 'MODULE_BUSY' | 'DUPLICATE_CONTRIBUTION'
  | 'UNDECLARED_CONTRIBUTION' | 'UNSUPPORTED_CONTRIBUTION' | 'ENTITLEMENT_DENIED'
  | 'ACTIVATION_FAILED' | 'DISPOSAL_FAILED';

export class ModuleContractError extends Error {
  constructor(public readonly code: ModuleFailureCodeV1, message: string, public readonly field?: string) {
    super(message);
    this.name = 'ModuleContractError';
  }
}

export interface ModuleSnapshotV1 {
  manifest: ModuleManifestV1;
  state: ModuleRuntimeStateV1;
  activeCalls: number;
  failure?: { code: ModuleFailureCodeV1; message: string };
}

export interface ModuleLifecycleEventV1 {
  schemaVersion: 1;
  moduleId: string;
  moduleVersion: string;
  statusBefore: ModuleRuntimeStateV1;
  statusAfter: ModuleRuntimeStateV1;
  errorCode?: ModuleFailureCodeV1;
}
