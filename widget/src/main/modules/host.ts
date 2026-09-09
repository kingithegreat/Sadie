import {
  MODULE_HOST_API_VERSION, ModuleContractError, ModuleFailureCodeV1, ModuleLifecycleEventV1,
  ModuleManifestV1, ModuleRuntimeStateV1, ModuleSnapshotV1,
} from '../../shared/modules/contracts';
import { moduleVersionFits, parseModuleManifest } from '../../shared/modules/manifest';
import type { ToolCall, ToolContext, ToolDefinition, ToolHandler, ToolResult } from '../tools/types';
import type { ModuleToolOwner } from '../tools/registry';

type RegistrationDispose = () => void;
// Cleanup return values are ignored except for Promise-like completion. Using
// unknown preserves ordinary `() => array.push(...)` callbacks while allowing
// async cleanup to be tracked explicitly.
type ResourceDispose = () => unknown;

type OwnedDisposer =
  | { dispose: RegistrationDispose; registration: true }
  | { dispose: ResourceDispose; registration: false };

export interface TrustedModuleContextV1 {
  readonly manifest: ModuleManifestV1;
  registerTool(capabilityId: string, definition: ToolDefinition, handler: ToolHandler): void;
  onDispose(dispose: ResourceDispose): void;
  /** Always delegates to Core's existing permission/confirmation executor. */
  invokeTool(call: ToolCall, context: ToolContext): Promise<ToolResult>;
}

export interface TrustedModuleDefinitionV1 {
  manifest: unknown;
  /** Registration only: I/O belongs in invoked jobs, not desktop startup. */
  activate(context: TrustedModuleContextV1): void | ResourceDispose;
}

export interface ModuleHostServicesV1 {
  platform: string;
  registerTool(owner: ModuleToolOwner, definition: ToolDefinition, handler: ToolHandler): RegistrationDispose;
  invokeTool(call: ToolCall, context: ToolContext): Promise<ToolResult>;
  canUseGrants?(grants: readonly string[]): boolean;
  supportsView?(viewId: string): boolean;
  recordEvent?(event: ModuleLifecycleEventV1): void;
}

interface ModuleRecord {
  manifest: ModuleManifestV1;
  activate: TrustedModuleDefinitionV1['activate'];
  state: ModuleRuntimeStateV1;
  generation: number;
  disposers: OwnedDisposer[];
  activeCalls: number;
  idleWaiters: Array<() => void>;
  failure?: ModuleSnapshotV1['failure'];
  draining?: Promise<void>;
}

/** One lifecycle owner around the deployed registry; no separate tool dispatcher or scheduler. */
export class TrustedModuleHost {
  private readonly modules = new Map<string, ModuleRecord>();
  constructor(private readonly services: ModuleHostServicesV1) {}

  /** Preflight a whole bundle before installing anything, including cycles across new modules. */
  install(definitions: TrustedModuleDefinitionV1[]): void {
    const next = new Map(this.modules);
    for (const definition of definitions) {
      const manifest = parseModuleManifest(definition.manifest);
      if (next.has(manifest.id)) throw new ModuleContractError('DUPLICATE_MODULE', `Module ${manifest.id} is already installed.`);
      if (typeof definition.activate !== 'function') throw new ModuleContractError('INVALID_MANIFEST', `Module ${manifest.id} has no trusted activation function.`);
      if (!moduleVersionFits(MODULE_HOST_API_VERSION, manifest.hostApi)) throw new ModuleContractError('INCOMPATIBLE_HOST', `${manifest.display.name} requires a different HomeBot module API.`);
      if (!manifest.platforms.includes(this.services.platform as ModuleManifestV1['platforms'][number])) throw new ModuleContractError('UNSUPPORTED_PLATFORM', `${manifest.display.name} is unavailable on this operating system.`);
      if (manifest.contributions.views.some(id => this.services.supportsView?.(id) !== true) || manifest.contributions.settings.length || manifest.contributions.providers.length) throw new ModuleContractError('UNSUPPORTED_CONTRIBUTION', `${manifest.display.name} requires a contribution type this host does not yet support.`);
      next.set(manifest.id, { manifest, activate: definition.activate, state: 'disabled', generation: 0, disposers: [], activeCalls: 0, idleWaiters: [] });
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new ModuleContractError('DEPENDENCY_CYCLE', `Module dependency cycle: ${[...visiting, id].join(' → ')}.`);
      if (visited.has(id)) return;
      visiting.add(id);
      const record = next.get(id)!;
      for (const dependency of record.manifest.dependencies) {
        const target = next.get(dependency.id);
        if (!target) throw new ModuleContractError('DEPENDENCY_MISSING', `${id} requires ${dependency.id}.`);
        if (!moduleVersionFits(target.manifest.version, dependency.version)) throw new ModuleContractError('DEPENDENCY_INCOMPATIBLE', `${id} requires a compatible version of ${dependency.id}.`);
        visit(dependency.id);
      }
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of next.keys()) visit(id);
    for (const [id, record] of next) this.modules.set(id, record);
  }

  list(): ModuleSnapshotV1[] {
    return [...this.modules.values()].map(record => {
      let access: ModuleSnapshotV1['access'] = 'available';
      try { this.assertGrants(record); } catch { access = 'locked'; }
      return { manifest: record.manifest, state: record.state, activeCalls: record.activeCalls, access, ...(record.failure ? { failure: { ...record.failure } } : {}) };
    });
  }

  private record(id: string): ModuleRecord {
    const record = this.modules.get(id);
    if (!record) throw new ModuleContractError('MODULE_UNAVAILABLE', `Module ${id} is not installed.`);
    return record;
  }

  private transition(record: ModuleRecord, state: ModuleRuntimeStateV1, failure?: ModuleSnapshotV1['failure']): void {
    const before = record.state;
    record.state = state;
    record.failure = failure;
    try { this.services.recordEvent?.({ schemaVersion: 1, moduleId: record.manifest.id, moduleVersion: record.manifest.version, statusBefore: before, statusAfter: state, ...(failure ? { errorCode: failure.code } : {}) }); } catch { /* logging cannot grant access or stop cleanup */ }
  }

  /** Invoke every disposer now, then report once all asynchronous cleanup settles. */
  private release(entries: OwnedDisposer[]): { failed: boolean; pending?: Promise<boolean> } {
    let failed = false;
    const pending: Array<Promise<boolean>> = [];
    for (const entry of entries) {
      try {
        const result = entry.dispose();
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
          // Attach the rejection handler in the same turn so cleanup cannot
          // become an unhandled rejection while the host waits for the rest.
          pending.push(Promise.resolve(result).then(() => false, () => true));
        }
      } catch {
        failed = true;
      }
    }
    if (!pending.length) return { failed };
    return {
      failed,
      pending: Promise.all(pending).then(results => failed || results.some(Boolean)),
    };
  }

  assertEnabled(id: string): void {
    const record = this.record(id);
    if (record.state !== 'enabled') throw new ModuleContractError('MODULE_UNAVAILABLE', `${record.manifest.display.name} is ${record.state}.`);
    this.assertGrants(record);
  }

  private assertGrants(record: ModuleRecord): void {
    if (!record.manifest.grants.length) return;
    let allowed = false;
    try { allowed = this.services.canUseGrants?.(record.manifest.grants) === true; } catch { /* fail closed */ }
    if (!allowed) throw new ModuleContractError('ENTITLEMENT_DENIED', `${record.manifest.display.name} needs a valid capability grant.`);
  }

  enable(id: string): void {
    const record = this.record(id);
    if (record.state === 'enabled') return;
    if (record.state === 'enabling' || record.state === 'draining') throw new ModuleContractError('MODULE_BUSY', `${id} is ${record.state}.`);
    if (record.failure?.code === 'DISPOSAL_FAILED') throw new ModuleContractError('DISPOSAL_FAILED', `${id} needs an application restart before it can safely start again.`);
    this.assertGrants(record);
    for (const dep of record.manifest.dependencies) {
      if (this.record(dep.id).state !== 'enabled') throw new ModuleContractError('DEPENDENCY_DISABLED', `Enable ${dep.id} before ${id}.`);
    }
    const generation = ++record.generation;
    const acquired: ModuleRecord['disposers'] = [];
    const registered = new Set<string>();
    this.transition(record, 'enabling');
    const acquiring = (): void => {
      if (record.state !== 'enabling' || record.generation !== generation) throw new ModuleContractError('MODULE_UNAVAILABLE', `${id} is no longer activating.`);
    };
    try {
      const dispose = record.activate(Object.freeze({
        manifest: record.manifest,
        registerTool: (capabilityId: string, definition: ToolDefinition, handler: ToolHandler) => {
          acquiring();
          if (!record.manifest.contributions.commands.includes(capabilityId)) throw new ModuleContractError('UNDECLARED_CONTRIBUTION', `${id} did not declare ${capabilityId}.`);
          if (registered.has(capabilityId)) throw new ModuleContractError('DUPLICATE_CONTRIBUTION', `${capabilityId} was registered twice.`);
          if ([definition.name, ...(definition.requiredPermissions || [])].some(permission => !record.manifest.permissions.includes(permission))) throw new ModuleContractError('UNDECLARED_CONTRIBUTION', `${capabilityId} did not declare every required permission.`);
          const owner = { moduleId: id, capabilityId, generation };
          const guarded: ToolHandler = async (args, context) => {
            try { return await this.invokeGeneration(record, generation, () => handler(args, context)); }
            catch (error) {
              if (error instanceof ModuleContractError) return { success: false, error: error.message, code: error.code };
              throw error;
            }
          };
          acquired.push({ dispose: this.services.registerTool(owner, definition, guarded), registration: true });
          registered.add(capabilityId);
        },
        onDispose: (cleanup: ResourceDispose) => {
          acquiring();
          if (typeof cleanup !== 'function') throw new ModuleContractError('ACTIVATION_FAILED', `${id} supplied an invalid cleanup function.`);
          acquired.push({ dispose: cleanup, registration: false });
        },
        invokeTool: (call: ToolCall, context: ToolContext) => this.invokeGeneration(record, generation, () => this.services.invokeTool(call, context)),
      }));
      // Runtime check too: a cast cannot turn asynchronous initialization into
      // atomic registration. Observe a returned Promise immediately so a later
      // rejection cannot escape after this generation has already been closed.
      if (dispose !== undefined && typeof dispose !== 'function') {
        void Promise.resolve(dispose as unknown).catch(() => undefined);
        throw new ModuleContractError('ACTIVATION_FAILED', `${id} must register synchronously.`);
      }
      if (registered.size !== record.manifest.contributions.commands.length) throw new ModuleContractError('UNDECLARED_CONTRIBUTION', `${id} did not register every declared command.`);
      if (dispose) acquired.push({ dispose, registration: false });
      record.disposers = acquired;
      this.transition(record, 'enabled');
    } catch (error) {
      // Close the generation before cleanup so retained callbacks cannot call or register anything.
      const failure = this.failure(error, 'ACTIVATION_FAILED', `${record.manifest.display.name} could not start.`);
      this.transition(record, 'failed', failure);
      const cleanup = this.release(acquired.reverse());
      record.disposers = [];
      if (cleanup.pending) {
        // No retry can enter while partial activation resources are still
        // rolling back. Successful rollback preserves the activation failure;
        // a rejected cleanup makes disposal failure sticky until restart.
        this.transition(record, 'draining', failure);
        record.draining = cleanup.pending.then(cleanupFailed => {
          this.transition(record, 'failed', cleanupFailed
            ? { code: 'DISPOSAL_FAILED', message: `${record.manifest.display.name} could not release every resource.` }
            : failure);
        }).finally(() => { record.draining = undefined; });
      } else if (cleanup.failed) {
        this.transition(record, 'failed', { code: 'DISPOSAL_FAILED', message: `${record.manifest.display.name} could not release every resource.` });
      }
      throw new ModuleContractError(failure.code, failure.message);
    }
  }

  private async invokeGeneration<T>(record: ModuleRecord, generation: number, operation: () => T | Promise<T>): Promise<T> {
    this.assertEnabled(record.manifest.id);
    if (this.modules.get(record.manifest.id) !== record || record.generation !== generation) throw new ModuleContractError('MODULE_UNAVAILABLE', `${record.manifest.display.name} changed while the request was waiting.`);
    record.activeCalls++;
    try { return await operation(); }
    finally {
      record.activeCalls--;
      if (!record.activeCalls) record.idleWaiters.splice(0).forEach(resolve => resolve());
    }
  }

  invoke<T>(id: string, operation: () => T | Promise<T>): Promise<T> {
    const record = this.record(id);
    return this.invokeGeneration(record, record.generation, operation);
  }

  private failure(error: unknown, code: ModuleFailureCodeV1, message: string): NonNullable<ModuleSnapshotV1['failure']> {
    return error instanceof ModuleContractError ? { code: error.code, message: error.message } : { code, message };
  }

  async disable(id: string): Promise<void> {
    const record = this.record(id);
    if (record.draining) return record.draining;
    if (record.state === 'disabled') return;
    // A second disable cannot certify that a failed cleanup released its resources.
    if (record.failure?.code === 'DISPOSAL_FAILED') return;
    if (record.state === 'enabling') throw new ModuleContractError('MODULE_BUSY', `${id} is enabling.`);
    const dependents = [...this.modules.values()].filter(other => ['enabled', 'enabling', 'draining'].includes(other.state) && other.manifest.dependencies.some(dep => dep.id === id));
    if (dependents.length) throw new ModuleContractError('ACTIVE_DEPENDENTS', `Disable ${dependents.map(dep => dep.manifest.display.name).join(', ')} before ${record.manifest.display.name}.`);
    this.transition(record, 'draining');
    // Remove exposure immediately; existing work drains under its already-started invocation.
    const disposers = record.disposers.splice(0).reverse();
    const registrations = this.release(disposers.filter(
      (item): item is Extract<OwnedDisposer, { registration: true }> => item.registration,
    ));
    let failed = registrations.failed;
    const idle = record.activeCalls ? new Promise<void>(resolve => record.idleWaiters.push(resolve)) : Promise.resolve();
    record.draining = idle.then(async () => {
      if (registrations.pending) failed = (await registrations.pending) || failed;
      // Running handlers retain their resources until they finish. M3 adds worker cancellation.
      const resources = this.release(disposers.filter(
        (item): item is Extract<OwnedDisposer, { registration: false }> => !item.registration,
      ));
      failed = failed || resources.failed;
      if (resources.pending) failed = (await resources.pending) || failed;
      this.transition(record, failed ? 'failed' : 'disabled', failed ? { code: 'DISPOSAL_FAILED', message: `${record.manifest.display.name} could not release every resource.` } : undefined);
      record.draining = undefined;
    });
    return record.draining;
  }

  uninstall(id: string): void {
    const record = this.record(id);
    if (record.state !== 'disabled') throw new ModuleContractError('MODULE_BUSY', `Disable ${id} before removing its registration.`);
    const dependent = [...this.modules.values()].find(other => other.manifest.dependencies.some(dep => dep.id === id));
    if (dependent) throw new ModuleContractError('ACTIVE_DEPENDENTS', `${dependent.manifest.id} still requires ${id}.`);
    this.modules.delete(id); // Manifests and registrations only. Never touches project data.
  }

  async disposeAll(): Promise<void> {
    const visited = new Set<string>();
    const stop = async (id: string): Promise<void> => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const other of this.modules.values()) if (other.manifest.dependencies.some(dep => dep.id === id)) await stop(other.manifest.id);
      await this.disable(id);
    };
    for (const id of this.modules.keys()) await stop(id);
  }
}
