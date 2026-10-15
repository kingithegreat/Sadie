import { spawn, type ChildProcess } from 'child_process';
import { rememberWorkspaceChild, stopWorkspaceChild } from '../workspace-owned-process';

jest.setTimeout(30_000);
const children: ChildProcess[] = [];
function start(source: string): ChildProcess {
  const child = spawn(process.execPath, ['-e', source], { detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child); rememberWorkspaceChild(child); return child;
}
afterEach(async () => { await Promise.all(children.splice(0).map(child => stopWorkspaceChild(child))); });
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function gone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && alive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  expect(alive(pid)).toBe(false);
}
test('bounded stop removes the owned process tree and preserves an unrelated process', async () => {
  const unrelated = start('setInterval(() => {}, 1000)');
  const owner = start('const {spawn}=require("child_process"); const child=spawn(process.execPath,["-e","setInterval(() => {}, 1000)"],{windowsHide:true,stdio:"ignore"}); console.log(child.pid); setInterval(() => {},1000);');
  const descendantPid = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned descendant did not report its PID.')), 4000);
    owner.stdout!.once('data', chunk => { clearTimeout(timer); resolve(Number(String(chunk).trim())); });
  });
  expect(Number.isInteger(descendantPid)).toBe(true); expect(alive(descendantPid)).toBe(true);
  const started = Date.now(); await stopWorkspaceChild(owner);
  await gone(owner.pid!); await gone(descendantPid);
  expect(alive(unrelated.pid!)).toBe(true); expect(Date.now() - started).toBeLessThan(9000);
  console.info(JSON.stringify({ ownedStopProof: { owner: owner.pid, descendant: descendantPid, unrelated: unrelated.pid, ownerGone: true, descendantGone: true, unrelatedAlive: true, elapsedMs: Date.now() - started } }));
});
