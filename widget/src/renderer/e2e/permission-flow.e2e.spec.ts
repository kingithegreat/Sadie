import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { launchElectronApp } from './launchElectron';

function makeTempProfile() {
  const base = path.join(os.tmpdir(), `sadie-e2e-${Date.now()}`);
  if (fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  return base;
}

test('permission escalation: Allow once, Always allow, persistence across restarts', async () => {
  test.setTimeout(60000);
  const tmp = makeTempProfile();
  const env = { SADIE_E2E: '1', NODE_ENV: 'test', HOME: tmp, USERPROFILE: tmp } as any;

  const { app, page } = await launchElectronApp(env, tmp);

  // Reset permissions to defaults
  await page.evaluate(async () => { await (window as any).electron.resetPermissions?.(); });

  // Sanity check: ping main and verify router logs capture the ping
  const ping = await page.evaluate(async () => await (window as any).electron.invoke('sadie:__e2e_ping'));
  expect(ping && ping.ok).toBe(true);
  const logsAfterPing = await page.evaluate(async () => await (window as any).electron.invoke('sadie:__e2e_get_router_logs'));
  expect(Array.isArray(logsAfterPing) && logsAfterPing.some((l:any)=>String(l).includes('[E2E] ping'))).toBe(true);

  // Verify permissions are disabled as expected
  const perms = await page.evaluate(async () => ({
    generate: await (window as any).electron.hasPermission('generate_sports_report'),
    write: await (window as any).electron.hasPermission('write_file')
  }));
  if (perms.generate?.allowed !== false || perms.write?.allowed !== false) {
    throw new Error(`Permissions not reset as expected: ${JSON.stringify(perms)}`);
  }

  // Invoke the tool batch which requires generate_sports_report + write_file
  const call = [{ name: 'generate_sports_report', arguments: { league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBA', format: 'txt' } }];

  // Start the invoke in the renderer context (it will cause a permission-request IPC)
  const invokePromise = page.evaluate(async (c) => await (window as any).electron.invoke('sadie:__e2e_invoke_tool_batch', { calls: c }), call);

  // If the invoke returns quickly, capture the immediate result for diagnostics
  const immediate = await Promise.race([invokePromise.then((r:any)=>({ settled: true, res: r })).catch((e:any)=>({ settled: true, res: { ok: false, error: String(e) } })), new Promise(r=>setTimeout(()=>r({ settled: false }), 300)) as any]) as any;
  if (immediate && immediate.settled) {
    // If it ran and returned, include it in diagnostics
    console.log('[E2E-DEBUG] invoke returned immediately', immediate.res);
    try { (global as any).__SADIE_E2E_INVOKE_RESULT = immediate.res; } catch (e) {}
  }
  // Give the main a short moment to respond; if it resolves quickly it likely didn't need permission
  const maybeDone = await Promise.race([invokePromise.then((r:any)=>({ settled: true, res: r })).catch((e:any)=>({ settled: true, res: { ok: false, error: String(e) } })), new Promise(r=>setTimeout(()=>r({ settled: false }), 200)) as any]) as any;
  if (maybeDone.settled) {
    // Main resolved quickly — inspect result to understand why no permission request was sent
    if (maybeDone.res && maybeDone.res.ok) {
      throw new Error(`Tool batch executed immediately without permission request; result=${JSON.stringify(maybeDone.res)}`);
    }
    // If it failed, continue to wait for permission modal as normal
  }

  // Wait for either the renderer to observe a permission request (diagnostic) or the modal to appear
  const lastPerm = await page.waitForFunction(() => !!(window as any).__lastPermissionRequest || !!document.querySelector('div:has-text("Permission Required")'), null, { timeout: 10000 }).then(async () => {
    // Return both sources of truth
    return await page.evaluate(() => ({ lastPermissionRequest: (window as any).__lastPermissionRequest || null, bodyText: document.body.innerText }));
  }).catch(async () => {
    const body = await page.evaluate(() => document.body.innerText);
    return { lastPermissionRequest: null, bodyText: body };
  });

  if (!lastPerm.lastPermissionRequest && !/Permission Required/.test(lastPerm.bodyText)) {
    // Gather additional diagnostics (userData path) then fail
    const envInfo = await page.evaluate(async () => await (window as any).electron.getEnv());
    const routerLogs = await page.evaluate(async () => await (window as any).electron.invoke('sadie:__e2e_get_router_logs'));
    const settings = await page.evaluate(async () => await (window as any).electron.getSettings());
    throw new Error(`Permission modal not observed. lastPermissionRequest=${JSON.stringify(lastPerm.lastPermissionRequest)}, bodyTextSnippet=${String(lastPerm.bodyText).substring(0,300)}, env=${JSON.stringify(envInfo)}, settings=${JSON.stringify(settings.permissions)}, routerLogs=${JSON.stringify(routerLogs.slice(-20))}`);
  }

  // Modal should be visible now; proceed to interact with it. Wait longer to account for async IPC.
  await page.waitForFunction(() => !!document.querySelector('[data-role="permission-modal"]') || document.body && document.body.innerText && document.body.innerText.includes('Permission Required'), null, { timeout: 30000 });
  const pm = page.locator('[data-role="permission-modal"]');
  // Helper that clicks a named role button; falls back to direct DOM click if overlay intercepts pointer events
  async function clickRoleButton(name: string) {
    try {
      await page.getByRole('button', { name: new RegExp(name, 'i') }).click({ timeout: 5000 });
    } catch (e) {
      // fallback: click via DOM to avoid Playwright actionability checks
      await page.evaluate((n) => {
        const re = new RegExp(n, 'i');
        const btn = Array.from(document.querySelectorAll('button')).find(b => re.test(b.innerText));
        if (btn) (btn as HTMLElement).click();
      }, name);
      await page.waitForTimeout(200);
    }
  }
  if ((await pm.count()) === 0) {
    // Fallback in case the modal is present but lacks the data-role (older builds)
    await expect(page.getByText('Permission Required')).toBeVisible({ timeout: 1000 });
    // Ensure any first-run overlay is gone so clicks are not intercepted
    await page.waitForSelector('.first-run-overlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
    await clickRoleButton('Allow once');
  } else {
    await expect(pm).toBeVisible({ timeout: 1000 });
    // Ensure any first-run overlay is gone so clicks are not intercepted
    await page.waitForSelector('.first-run-overlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
    await clickRoleButton('Allow once');
    await expect(pm).toBeHidden({ timeout: 5000 });
  }

  const res1: any = await invokePromise;
  expect(res1.ok).toBe(true);
  // Verify the report file was created in the temp Desktop
  const reportPath = path.join(tmp, 'Desktop', 'TestNBA', 'report.txt');
  expect(fs.existsSync(reportPath)).toBe(true);

  // Ask again - should prompt again (Allow once)
  const invoke2 = page.evaluate(async (c) => await (window as any).electron.invoke('sadie:__e2e_invoke_tool_batch', { calls: c }), call);
  // Wait for the permission modal to re-appear, then choose Always allow (with fallback)
  await page.waitForFunction(() => !!document.querySelector('[data-role="permission-modal"]') || document.body && document.body.innerText && document.body.innerText.includes('Permission Required'), null, { timeout: 20000 });
  if ((await pm.count()) === 0) {
    await expect(page.getByText('Permission Required')).toBeVisible({ timeout: 1000 });
    // Ensure any first-run overlay is gone so clicks are not intercepted
    await page.waitForSelector('.first-run-overlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
    await clickRoleButton('Always allow');
  } else {
    await expect(pm).toBeVisible({ timeout: 1000 });
    // Ensure any first-run overlay is gone so clicks are not intercepted
    await page.waitForSelector('.first-run-overlay', { state: 'hidden', timeout: 10000 }).catch(() => {});
    await clickRoleButton('Always allow');
    await expect(pm).toBeHidden({ timeout: 5000 });
  }
  const res2: any = await invoke2;
  expect(res2.ok).toBe(true);

  // Restart app (close and relaunch with same profile)
  await app.close();
  const { app: app2, page: page2 } = await launchElectronApp(env, tmp);

  // Now invoke again - should NOT show modal and should run immediately
  const invoke3 = page2.evaluate(async (c) => await (window as any).electron.invoke('sadie:__e2e_invoke_tool_batch', { calls: c }), call);
  // Ensure modal does not appear after restart and invocation
  await expect(page2.locator('[data-role="permission-modal"]')).toBeHidden({ timeout: 2000 });
  const res3: any = await invoke3;
  expect(res3.ok).toBe(true);

  await app2.close();
});

test('no permission modal when permissions already allowed', async () => {
  const tmp = makeTempProfile();
  const env = { SADIE_E2E: '1', NODE_ENV: 'test', HOME: tmp, USERPROFILE: tmp } as any;

  const { app, page } = await launchElectronApp(env, tmp);

  // Ensure settings explicitly allow the needed permissions
  await page.evaluate(async () => {
    const s = await (window as any).electron.getSettings();
    s.permissions = s.permissions || {};
    s.permissions.generate_sports_report = true;
    s.permissions.write_file = true;
    await (window as any).electron.saveSettings(s);
  });

  const call = [{ name: 'generate_sports_report', arguments: { league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBA', format: 'txt' } }];

  // Invoke and ensure it runs immediately and no modal appears
  const invoke = page.evaluate(async (c) => await (window as any).electron.invoke('sadie:__e2e_invoke_tool_batch', { calls: c }), call);
  // short wait to ensure modal doesn't appear
  await page.waitForTimeout(300);
  await expect(page.getByText('Permission Required')).toHaveCount(0);

  const res: any = await invoke;
  expect(res.ok).toBe(true);

  // Verify the report file was created
  const reportPath = path.join(tmp, 'Desktop', 'TestNBA', 'report.txt');
  expect(fs.existsSync(reportPath)).toBe(true);

  await app.close();
});
