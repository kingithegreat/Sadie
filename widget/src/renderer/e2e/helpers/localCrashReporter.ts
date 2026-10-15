import type { App, CrashReporter } from 'electron';

/** Serialized into the captured Electron main; never used by the product. */
export function startLocalNativeCrashReporter(electron: {
  app: Pick<App, 'getPath'>;
  crashReporter: Pick<CrashReporter, 'start' | 'getUploadToServer' | 'getParameters'>;
}, identity: { pid: number; nonce: string }): Record<string, unknown> {
  if (process.env.HOMEBOT_NATIVE_LOCAL_CRASH_REPORTS !== '1') return { status: 'disabled' };
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows'
    || process.env.HOMEBOT_E2E !== '1' || process.env.NODE_ENV !== 'test') throw new Error('Local crash collection requires the isolated Windows CI fixture.');
  if (process.pid !== identity.pid || !identity.nonce) throw new Error('Crash reporter main identity differs from the held main.');
  const fs = (process as any).getBuiltinModule('fs');
  const path = (process as any).getBuiltinModule('path');
  const root = process.env.HOMEBOT_NATIVE_LOCAL_CRASH_ROOT;
  const profile = process.env.HOMEBOT_E2E_USER_DATA_DIR;
  if (!root || !profile || !path.isAbsolute(root) || !path.isAbsolute(profile)) throw new Error('Private crash collection root/profile missing.');
  const canonical = (value: string): string => fs.realpathSync.native(value);
  const inside = (parent: string, child: string): boolean => {
    const relative = path.relative(parent, child);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const actualRoot = canonical(root), actualProfile = canonical(profile);
  const dumpPath = electron.app.getPath('crashDumps');
  if (!inside(actualRoot, actualProfile) || canonical(electron.app.getPath('userData')) !== actualProfile
    || dumpPath !== path.join(profile, 'CrashDumps') || canonical(dumpPath) !== path.join(actualProfile, 'CrashDumps')) {
    throw new Error('Crash reporter paths differ from the private fixture contract.');
  }
  const parameters = { homebot_native_pid: String(identity.pid), homebot_native_nonce: identity.nonce };
  // A pre-existing reporter makes start a no-op. Exact parameters then refuse
  // that configuration rather than silently claiming it was ours.
  electron.crashReporter.start({ uploadToServer: false, extra: parameters });
  const actual = electron.crashReporter.getParameters();
  if (electron.crashReporter.getUploadToServer() !== false || actual.homebot_native_pid !== parameters.homebot_native_pid
    || actual.homebot_native_nonce !== parameters.homebot_native_nonce) throw new Error('Local crash reporter configuration was not established.');
  return { status: 'started', pid: identity.pid, nonce: identity.nonce, dumpPath, uploadToServer: false,
    requestedSubmitURL: null, parameters: actual, limits: 'Crashpad changes collection only; a dump or reporter start does not prove shutdown or identify a crash cause.' };
}
