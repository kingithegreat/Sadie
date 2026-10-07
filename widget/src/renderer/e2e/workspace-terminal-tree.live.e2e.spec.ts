import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import { dismissFirstRun } from './helpers/firstRun';
import { closeElectronApp } from './helpers/closeApp';
import { terminalTreeSources, validateTerminalSources, recordTerminalFailure, terminalDiagnosticText, settleTerminalCleanup } from './helpers/terminalTreeFixture';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { queryWorkspacePtyIdentity, workspacePtyLifecycle } from '../../main/workspace-pty-identity';

test.skip(process.platform !== 'win32' || process.env.HOMEBOT_LIVE_TASK_TREE !== '1', 'Opt-in actual Windows native Job/ConPTY fixture.');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
async function closeHeld(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>(resolve => child.once('close', () => resolve())); child.kill(); await closed;
}

test('interactive terminal retains a late grandchild after its parents exit and Close preserves unrelated owned process', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hbi-terminal-job-')), profile = path.join(home, 'profile'), project = path.join(home, 'project');
  for (const directory of [project, path.join(profile, 'config'), path.join(home, 'tmp'), path.join(home, 'ap'), path.join(home, 'movies'), path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local')]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(home, 'ap', 'run_pipeline.py'), '# Private fixture; provider disabled.\n');
  fs.writeFileSync(path.join(profile, 'config', 'user-settings.json'), JSON.stringify({ projectPath: project, morningBriefing: false }));
  fs.writeFileSync(path.join(profile, 'config', 'mcp-servers.json'), JSON.stringify({ servers: [] }));
  const ttyMarker = path.join(project, 'tty.json'), interruptMarker = path.join(project, 'interrupt.json'), grandchildMarker = path.join(project, 'grandchild.json'), intermediateGone = path.join(project, 'intermediate-exited.txt');
  const write = (name: string, content: string) => fs.writeFileSync(path.join(project, name), content);
  const sources = terminalTreeSources(project);
  validateTerminalSources(sources);
  for (const [name, source] of Object.entries(sources)) write(name, source);
  const hashes = () => Object.fromEntries(['stdin.cjs', 'interrupt.cjs', 'grandchild.cjs', 'intermediate.cjs', 'late-root.cjs'].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(project, name))).digest('hex')]));
  const before = hashes();
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test', HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TEMP: path.join(home, 'tmp'), TMP: path.join(home, 'tmp'), TMPDIR: path.join(home, 'tmp'),
    ANCIENT_PATHWAYS_DIR: path.join(home, 'ap'), HOMEBOT_MOVIE_PROJECTS_DIR: path.join(home, 'movies') }, profile);
  const unrelated = spawn(process.execPath, ['-e', "console.log('UNRELATED_READY');setInterval(()=>{},1000)"], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
  let unrelatedReady = false; unrelated.stdout!.on('data', data => { if (data.toString().includes('UNRELATED_READY')) unrelatedReady = true; });
  unrelated.on('error', () => {}); // Readiness must still succeed; no unhandled fixture spawn rejection.
  let closed = false, failed = false;
  try {
    await expect.poll(() => unrelatedReady).toBe(true);
    await waitForAppReady(page); await dismissFirstRun(page); await page.locator('[aria-label="Workspace"]').first().click();
    const panel = page.getByRole('region', { name: 'Interactive terminal', exact: true });
    await panel.getByRole('combobox', { name: 'Shell profile' }).selectOption('cmd');
    await panel.getByRole('button', { name: 'New terminal', exact: true }).click();
    const terminal = panel.getByRole('region', { name: 'Interactive cmd terminal' });
    await expect(terminal).toBeVisible();
    // xterm intentionally makes its keyboard helper zero-sized and transparent.
    const input = terminal.locator('.xterm-helper-textarea');
    await expect(input).toBeAttached(); await input.focus(); await expect(input).toBeFocused();
    const command = async (file: string, suffix = '') => { await input.focus(); await input.pressSequentially(`"${process.execPath}" "${path.join(project, file)}"${suffix}`); await input.press('Enter'); };
    await command('stdin.cjs'); await expect.poll(() => fs.existsSync(ttyMarker)).toBe(true);
    const initialTty = JSON.parse(fs.readFileSync(ttyMarker, 'utf8')); expect(initialTty.stdin).toBe(true); expect(initialTty.stdout).toBe(true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible())!.setSize(1750, 1050));
    await expect.poll(() => JSON.parse(fs.readFileSync(ttyMarker, 'utf8')).columns).not.toBe(initialTty.columns);
    // A second native stdin message lets the actual process report its resized console.
    await input.pressSequentially('NATIVE_STDIN'); await input.press('Enter');
    await expect.poll(() => JSON.parse(fs.readFileSync(ttyMarker, 'utf8')).input).toBe('NATIVE_STDIN');
    const resized = JSON.parse(fs.readFileSync(ttyMarker, 'utf8')); expect(resized.columns).not.toBe(initialTty.columns);
    await expect.poll(() => alive(resized.pid)).toBe(false);
    await command('interrupt.cjs'); await expect.poll(() => fs.existsSync(interruptMarker)).toBe(true);
    const interruptPid = JSON.parse(fs.readFileSync(interruptMarker, 'utf8')).pid; expect(alive(interruptPid)).toBe(true);
    await panel.getByRole('button', { name: 'Interrupt (Ctrl+C)' }).click(); await expect.poll(() => alive(interruptPid)).toBe(false);
    await command('late-root.cjs', ' & exit');
    await expect.poll(() => fs.existsSync(grandchildMarker) && fs.existsSync(intermediateGone), { timeout: 15000 }).toBe(true);
    const descendant = JSON.parse(fs.readFileSync(grandchildMarker, 'utf8')) as { pid: number; parent: number };
    const backgroundRoot = JSON.parse(fs.readFileSync(path.join(project, 'background-root.json'), 'utf8')) as { pid: number; child: number };
    expect(backgroundRoot.pid).toBeGreaterThan(0); expect(backgroundRoot.child).toBe(descendant.parent);
    await expect.poll(() => alive(descendant.parent)).toBe(false); expect(alive(descendant.pid)).toBe(true);
    await expect(panel.getByRole('tab', { name: /cmd.*exited/ })).toBeVisible();
    expect(await queryWorkspacePtyIdentity(backgroundRoot.pid)).toBeNull();
    expect(await queryWorkspacePtyIdentity(descendant.parent)).toBeNull();
    const descendantIdentity = await queryWorkspacePtyIdentity(descendant.pid);
    expect(descendantIdentity).toBeTruthy(); expect(descendantIdentity!.parent).toBe(descendant.parent);
    const retained = await page.evaluate(async projectDir => (window as any).electron.workspaceTerminalList({ projectDir }), project);
    const session = retained.sessions.find((item: { profileId: string }) => item.profileId === 'cmd');
    expect(session.pid).toBeGreaterThan(0); expect(session.shellPid).toBeGreaterThan(0); expect(session.pid).not.toBe(session.shellPid);
    expect(session.exited).toBe(true); expect(session.closeError).toContain('background');
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull();
    await page.screenshot({ path: testInfo.outputPath('terminal-retained-background.png') });
    const tabs = await panel.getByRole('tab').allTextContents(), index = tabs.findIndex(name => name.includes('cmd')) + 1;
    expect(await workspacePtyLifecycle.stopped(descendant.pid, descendantIdentity)).toBe(false);
    await panel.getByRole('button', { name: `Close terminal ${index}`, exact: true }).click();
    await expect(panel.getByRole('tab', { name: /cmd/ })).toHaveCount(0); expect(alive(descendant.pid)).toBe(false);
    expect(await workspacePtyLifecycle.stopped(descendant.pid, descendantIdentity)).toBe(true);
    expect(unrelated.exitCode).toBeNull(); expect(unrelated.signalCode).toBeNull(); expect(hashes()).toEqual(before);
    fs.writeFileSync(testInfo.outputPath('terminal-job-proof.json'), JSON.stringify({ session, descendant, descendantIdentity, backgroundRoot, bothParentsGone: true, intermediateGone: true, descendantGone: true, unrelatedPid: unrelated.pid, unrelatedAlive: true, stdin: resized, fixtureHashes: before }, null, 2));
    await closeElectronApp(app, 'retained terminal Job fixture'); closed = true;
  } catch (error) {
    failed = true;
    // Diagnostics cannot replace the original functional assertion or its deadline.
    try { await recordTerminalFailure(page, project, testInfo); } catch (diagnosticError) {
      try { fs.writeFileSync(testInfo.outputPath('terminal-diagnostic-error.json'), JSON.stringify({ error: terminalDiagnosticText(String(diagnosticError)) })); } catch { /* Preserve the original failure even if artifacts cannot be written. */ }
    }
    throw error;
  } finally {
    await settleTerminalCleanup([closed ? Promise.resolve() : closeElectronApp(app, 'terminal Job fixture failure'), closeHeld(unrelated)], failed,
      errors => fs.writeFileSync(testInfo.outputPath('terminal-cleanup-error.json'), JSON.stringify({ errors: errors.map(error => terminalDiagnosticText(String(error))) })));
  }
});
