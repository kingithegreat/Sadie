/** Native opt-in: actual retained Windows Job, fixed pipe/bootstrap and npm. */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
jest.mock('../user-paths', () => ({ homeDir: () => process.env.HOMEBOT_REAL_JOB_TASK_HOME! }));
jest.mock('electron', () => ({ app: { getPath: () => process.env.HOMEBOT_REAL_JOB_TASK_PROFILE! } }));
import { executeWorkspacePackageTask, prepareWorkspacePackageTask, stopWorkspaceTask, closeAllWorkspaceTasks } from '../workspace-tasks';
import { workspacePtyLifecycle } from '../workspace-pty-identity';

const nativeTest = process.platform === 'win32' && process.env.HOMEBOT_LIVE_TASK_TREE === '1' ? test : test.skip;
jest.setTimeout(45_000);
async function waitFor(check: () => boolean | Promise<boolean>, milliseconds = 10000): Promise<void> {
  const end = Date.now() + milliseconds;
  while (!await check()) { if (Date.now() >= end) throw new Error('Owned native fixture did not reach its expected state.'); await new Promise(resolve => setTimeout(resolve, 50)); }
}
async function closeHeld(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const close = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.kill(); await close;
}
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-job-real-')); process.env.HOMEBOT_REAL_JOB_TASK_HOME = home;
  process.env.HOMEBOT_REAL_JOB_TASK_PROFILE = path.join(home, 'profile');
  const project = path.join(home, 'project'); fs.mkdirSync(project);
  const writeScript = (command: string) => fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ scripts: { check: command } }));
  return { home, project, writeScript };
}

nativeTest('instant npm command executes once and completes without confusing a missing target PID with unknown ownership', async () => {
  const app = fixture(); const marker = path.join(app.project, 'instant-marker.txt');
  fs.writeFileSync(path.join(app.project, 'instant.cjs'), `require('fs').appendFileSync(${JSON.stringify(marker)}, 'ran-once:' + process.env.HOMEBOT_UTF8_JOB_CANARY + '\n');`);
  app.writeScript('node instant.cjs');
  try {
    const result = await executeWorkspacePackageTask(prepareWorkspacePackageTask(app.project, 'check'), { taskId: 'native:instant', longRunning: true, env: { HOMEBOT_UTF8_JOB_CANARY: '一🔧é' } });
    expect(result).toMatchObject({ success: true, exitCode: 0, cleanupPending: false });
    expect(fs.readFileSync(marker, 'utf8')).toBe('ran-once:一🔧é\n');
  } finally { await closeAllWorkspaceTasks(); fs.rmSync(app.home, { recursive: true, force: true }); }
});

nativeTest('late grandchild remains in the same retained Job after both parents exit; Stop removes it and preserves unrelated owned child', async () => {
  const app = fixture(); const marker = path.join(app.project, 'grandchild.json'), parentGone = path.join(app.project, 'intermediate-exited.txt');
  fs.writeFileSync(path.join(app.project, 'grandchild.cjs'), `require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{},1000);`);
  fs.writeFileSync(path.join(app.project, 'intermediate.cjs'), `setTimeout(()=>{const c=require('child_process').spawn(process.execPath,[${JSON.stringify(path.join(app.project, 'grandchild.cjs'))}],{stdio:'ignore'});c.once('spawn',()=>{c.unref();setTimeout(()=>process.exit(0),300);});},500);`);
  fs.writeFileSync(path.join(app.project, 'launch.cjs'), `const c=require('child_process').spawn(process.execPath,[${JSON.stringify(path.join(app.project, 'intermediate.cjs'))}],{stdio:'ignore'});c.once('exit',code=>{require('fs').writeFileSync(${JSON.stringify(parentGone)},String(code));});`);
  app.writeScript('node launch.cjs');
  const unrelated = spawn(process.execPath, ['-e', "console.log('UNRELATED_READY');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });
  unrelated.on('error', () => {}); // The ready assertion remains mandatory.
  let unrelatedReady = false; unrelated.stdout!.on('data', data => { if (data.toString().includes('UNRELATED_READY')) unrelatedReady = true; });
  let taskStarted = false;
  try {
    await waitFor(() => unrelatedReady);
    const run = executeWorkspacePackageTask(prepareWorkspacePackageTask(app.project, 'check'), { taskId: 'native:late-child', longRunning: true }); taskStarted = true;
    await waitFor(() => fs.existsSync(marker) && fs.existsSync(parentGone));
    const descendant = JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number; parent: number };
    const identity = await workspacePtyLifecycle.capture(descendant.pid);
    expect(identity).toBeTruthy(); expect(identity!.parent).toBe(descendant.parent);
    expect(await workspacePtyLifecycle.capture(descendant.parent)).toBeNull();
    const result = await run;
    expect(result).toMatchObject({ success: true, exitCode: 0, cleanupPending: true });
    expect(await workspacePtyLifecycle.stopped(descendant.pid, identity)).toBe(false);
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
    expect(await stopWorkspaceTask('native:late-child')).toBe(true);
    expect(await workspacePtyLifecycle.stopped(descendant.pid, identity)).toBe(true);
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
    expect(await stopWorkspaceTask('native:late-child')).toBe(true); // Same completed key cannot retarget anything.
  } finally {
    try { if (taskStarted) await closeAllWorkspaceTasks(); }
    finally { await closeHeld(unrelated); }
    fs.rmSync(app.home, { recursive: true, force: true });
  }
});
