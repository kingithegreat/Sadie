import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createOwnedMcpStdioTransport } from '../mcp-stdio-owned';
import { queryWorkspacePtyIdentity, workspacePtyLifecycle } from '../workspace-pty-identity';

const live = process.platform === 'win32' && process.env.HOMEBOT_LIVE_MCP_TREE === '1' ? test : test.skip;

async function stopHeldChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Exact unrelated control child did not close.')), 4000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    try { child.kill(); } catch (error) { clearTimeout(timer); reject(error); }
  });
}

live('owned SDK stdio service contains late descendants after intermediate exit and leaves unrelated control alive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-mcp-tree-'));
  const leaf = path.join(directory, 'leaf.js'), intermediate = path.join(directory, 'intermediate.js'), server = path.join(directory, 'server.js');
  const env = { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' };
  fs.writeFileSync(leaf, 'setInterval(()=>{},1000);console.log("LEAF_READY "+process.pid);\n');
  fs.writeFileSync(intermediate, [
    'const {spawn}=require("node:child_process");',
    'setTimeout(()=>{',
    ' const child=spawn(process.execPath,[process.argv[2]],{detached:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});',
    ' let output="";const timer=setTimeout(()=>{throw Error("Leaf readiness timeout");},4000);',
    ' child.stdout.on("data",chunk=>{output+=chunk;if(output.includes("LEAF_READY ")){clearTimeout(timer);console.log(JSON.stringify({jsonrpc:"2.0",method:"fixture/tree",params:{leafPid:child.pid,intermediatePid:process.pid}}));child.stdout.destroy();child.stderr.destroy();child.unref();}});',
    '},150);',
  ].join('\n'));
  fs.writeFileSync(server, [
    'const {spawn}=require("node:child_process");setInterval(()=>{},1000);',
    'console.log(JSON.stringify({jsonrpc:"2.0",method:"fixture/ready",params:{pid:process.pid}}));',
    'const child=spawn(process.execPath,[process.argv[2],process.argv[3]],{detached:true,windowsHide:true,stdio:["ignore","pipe","pipe"]});',
    'child.stdout.on("data",chunk=>process.stdout.write(chunk));child.stderr.resume();',
    'child.once("exit",(code,signal)=>console.log(JSON.stringify({jsonrpc:"2.0",method:"fixture/ended",params:{code,signal}})));',
  ].join('\n'));
  const owner = createOwnedMcpStdioTransport({ command: process.execPath, args: [server, intermediate, leaf], env, cwd: directory, stderr: 'pipe' });
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);console.log("UNRELATED_READY");'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  owner.transport.stderr?.on('data', () => {});
  const events: any[] = [];
  owner.transport.onmessage = message => { events.push(message); };
  let primaryFailure = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Unrelated live control failed readiness.')), 4000);
      unrelated.stdout!.once('data', () => { clearTimeout(timer); resolve(); });
      unrelated.once('error', error => { clearTimeout(timer); reject(error); });
    });
    await owner.transport.start();
    expect(owner.cleanupScope).toBe('windows-job');
    const deadline = Date.now() + 6000;
    while (!events.some(event => event.method === 'fixture/ended') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    expect(events.find(event => event.method === 'fixture/ready')?.params.pid).toBeGreaterThan(0);
    expect(events.find(event => event.method === 'fixture/ended')?.params).toEqual({ code: 0, signal: null });
    const tree = events.find(event => event.method === 'fixture/tree')?.params;
    expect(tree?.leafPid).toBeGreaterThan(0); expect(tree?.intermediatePid).toBeGreaterThan(0);
    const leafIdentity = await queryWorkspacePtyIdentity(tree.leafPid);
    expect(leafIdentity).toBeTruthy();
    expect(await workspacePtyLifecycle.stopped(tree.leafPid, leafIdentity)).toBe(false);
    expect(unrelated.exitCode).toBeNull(); expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    await owner.close(); // succeeds only retained Job ActiveProcesses=0 + helper close
    expect(await workspacePtyLifecycle.stopped(tree.leafPid, leafIdentity)).toBe(true);
    expect(unrelated.exitCode).toBeNull(); expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    console.info(JSON.stringify({ ownedMcpTreeProof: { servicePid: events.find(event => event.method === 'fixture/ready').params.pid,
      intermediatePid: tree.intermediatePid, leafPid: tree.leafPid, leafCreation: leafIdentity!.creation,
      unrelatedPid: unrelated.pid, intermediateEnded: true, leafAliveBeforeStop: true, jobCloseConfirmed: true,
      leafGoneAfterStop: true, unrelatedAliveAfterStop: true } }));
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    // Never guessed descendant/PID cleanup: retain exact owner and separately
    // held unrelated ChildProcess. Cleanup failure keeps this fixture failed.
    const cleanup = await Promise.allSettled([owner.close(), stopHeldChild(unrelated)]);
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length) {
      console.error(JSON.stringify({ ownedMcpCleanupFailure: failures.map(result => String(result.reason)), primaryFailurePreserved: primaryFailure, fixtureRetained: directory }));
      if (!primaryFailure) throw failures[0].reason;
    } else fs.rmSync(directory, { recursive: true, force: true });
  }
}, 45_000);
