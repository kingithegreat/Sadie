import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { performWorkspaceTests, stopWorkspaceTestRuns } from '../workspace-tests';
import { queryWorkspacePtyIdentity, workspacePtyLifecycle } from '../workspace-pty-identity';

jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
const live = process.platform === 'win32' && process.env.HOMEBOT_LIVE_TEST_TREE === '1' ? test : test.skip;

live('naturally ended Node test runner retains late descendants until Stop confirms its Job empty', async () => {
  const root = fs.mkdtempSync(path.join(os.homedir(), 'hb-test-tree-'));
  const file = path.join(root, 'late.test.js'), intermediate = path.join(root, 'intermediate.js'), leaf = path.join(root, 'leaf.js');
  fs.writeFileSync(leaf, 'setInterval(()=>{},1000);console.log("LEAF_READY "+process.pid);');
  fs.writeFileSync(intermediate, [
    'const {spawn}=require("node:child_process");setTimeout(()=>{',
    'const child=spawn(process.execPath,[process.argv[2]],{detached:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});',
    'let output="";const timer=setTimeout(()=>{throw Error("leaf not ready");},4000);',
    'child.stdout.on("data",chunk=>{output+=chunk;if(output.includes("LEAF_READY ")){clearTimeout(timer);console.log("LEAF_PID "+child.pid);child.stdout.destroy();child.stderr.destroy();child.unref();}});',
    '},150);',
  ].join('\n'));
  fs.writeFileSync(file, [
    'const {test}=require("node:test"),{spawn}=require("node:child_process"),path=require("node:path");',
    'test("late child",async()=>{const child=spawn(process.execPath,[path.join(__dirname,"intermediate.js"),path.join(__dirname,"leaf.js")],{detached:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});',
    'child.stdout.on("data",chunk=>process.stdout.write(chunk));child.stderr.resume();',
    'await new Promise((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>{if(code!==0)reject(Error("intermediate failed"));else {console.log("INTERMEDIATE_ENDED "+child.pid);resolve();}});});});',
  ].join('\n'));
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);console.log("UNRELATED_READY");'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' } });
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Unrelated readiness failed.')), 4000); unrelated.stdout!.once('data', () => { clearTimeout(timer); resolve(); }); unrelated.once('error', error => { clearTimeout(timer); reject(error); }); });
    expect((await performWorkspaceTests({ root, action: 'run', file })).success).toBe(true);
    let result = await performWorkspaceTests({ root, action: 'state' }); const deadline = Date.now() + 8000;
    while (result.running && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 30)); result = await performWorkspaceTests({ root, action: 'state' }); }
    expect(result).toMatchObject({ running: false, exitCode: 0, cleanupPending: true });
    expect(result.summary?.passed).toBeGreaterThan(0); expect(result.output).toContain('INTERMEDIATE_ENDED');
    const leafPid = Number(/LEAF_PID (\d+)/.exec(result.output || '')?.[1]); expect(leafPid).toBeGreaterThan(0);
    const identity = await queryWorkspacePtyIdentity(leafPid); expect(identity).toBeTruthy();
    expect(await workspacePtyLifecycle.stopped(leafPid, identity)).toBe(false);
    expect(unrelated.exitCode).toBeNull();
    const stopped = await performWorkspaceTests({ root, action: 'stop' }); expect(stopped).toMatchObject({ success: true, cleanupPending: false, running: false });
    expect(await workspacePtyLifecycle.stopped(leafPid, identity)).toBe(true); expect(unrelated.exitCode).toBeNull();
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    console.info(JSON.stringify({ ownedTestRunnerTreeProof: { leafPid, leafCreation: identity!.creation, naturallyEnded: true, executedPasses: result.summary?.passed,
      cleanupPendingBeforeStop: true, leafAliveBeforeStop: true, jobStopConfirmed: true, leafGoneAfterStop: true, unrelatedPid: unrelated.pid, unrelatedAliveAfterStop: true } }));
  } finally {
    await Promise.all([stopWorkspaceTestRuns(), new Promise<void>((resolve, reject) => {
      if (unrelated.exitCode !== null || unrelated.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('Held unrelated control did not close.')), 4000);
      unrelated.once('close', () => { clearTimeout(timer); resolve(); });
      try { unrelated.kill(); } catch (error) { clearTimeout(timer); reject(error); }
    })]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
