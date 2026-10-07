import { test, expect, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { openFirstUserFixture } from './first-user-native-bootstrap';

type ControlBounds = {
  label: string;
  viewport: { width: number; height: number };
  box: { x: number; y: number; width: number; height: number };
};

function inside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function visibleControl(page: Page, locator: Locator, label: string,
  minimumWidth: number, minimumHeight: number, receipts: ControlBounds[]) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} must have a painted box`).not.toBeNull();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box!.width, `${label} must have usable width`).toBeGreaterThanOrEqual(minimumWidth);
  expect(box!.height, `${label} must have usable height`).toBeGreaterThanOrEqual(minimumHeight);
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${label} top edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
  expect(await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !!top && (top === element || element.contains(top));
  }), `${label} must receive a click at its center`).toBe(true);
  receipts.push({ label, viewport, box: box! });
}

async function noSentUserMessages(page: Page) {
  // Read through the real preload/store; never inject a fake conversation IPC.
  const store = await page.evaluate(() => window.electron.loadConversations!());
  expect(store.success).toBe(true);
  const conversations = Object.values(store.data?.conversations || {}) as Array<{ messages?: Array<{ role: string }> }>;
  expect(conversations.length).toBeGreaterThan(0);
  expect(conversations.flatMap(conversation => conversation.messages || []).filter(message => message.role === 'user')).toHaveLength(0);
}

function assertClosedReceipt(receipt: any) {
  expect(receipt).toBeTruthy();
  expect(receipt).toMatchObject({ closeOutcome: 'closed', forced: false, closeError: null, refusal: null,
    nativeProbeSucceeded: true, launcherProbeSucceeded: true, nativeSameIdentityAlive: false,
    launcherSameIdentityAlive: false, safeToCloseServers: true });
  expect(receipt.forcedTargets).toEqual([]);
  for (const [label, identity, after] of [['native', receipt.nativeIdentity, receipt.nativeAfter],
    ['launcher', receipt.launcherIdentity, receipt.launcherAfter]] as const) {
    expect(identity, `${label} must have a captured creation identity`).toBeTruthy();
    expect(Number.isSafeInteger(identity.ProcessId)).toBe(true);
    expect(identity.ProcessId).toBeGreaterThan(0);
    expect(identity.CreationDate).toBeTruthy();
    expect(identity.ExecutablePath).toBeTruthy();
    const sameIdentity = after && after.ProcessId === identity.ProcessId && after.ParentProcessId === identity.ParentProcessId
      && after.CreationDate === identity.CreationDate && after.ExecutablePath?.toLowerCase() === identity.ExecutablePath.toLowerCase();
    expect(!!sameIdentity, `${label} exact creation identity must be absent`).toBe(false);
  }
  // CIM disappearance does not establish the native main's OS exit code.
}

test('post-setup compact discovery and editable draft survive Home navigation in dark/light narrow windows', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_FIRST_USER_NATIVE !== '1', 'Opt-in private compiled runtime; no external provider or owner profile.');
  test.skip(process.platform !== 'win32', 'This acceptance records Windows native window/process identity.');
  test.setTimeout(150_000);
  const runtime = await openFirstUserFixture({ testInfo, firstRun: false, inventory: 'installed' });
  const { app, page } = runtime;
  const bounds: ControlBounds[] = [];
  const brief = 'Help me write a polite reply declining the 10am meeting and offering Friday afternoon.';
  const content = 'Meeting notes: proposed 10am; my available alternative is Friday afternoon.\n';
  let attachmentPath: string | undefined;
  const errors: unknown[] = [];
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const ownedWindow = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('HomeBot'));
      if (!ownedWindow) throw new Error('The owned HomeBot window is unavailable.');
      if (ownedWindow.isMinimized()) ownedWindow.restore();
      ownedWindow.show();
      ownedWindow.focus();
    });
    await page.bringToFront();
    await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-hydrated', 'true');
    const environment = await page.evaluate(() => window.electron.getEnv!());
    expect(environment.isE2E).toBe(false);
    const paths = await app.evaluate(({ app }) => {
      const builtins = (process as any).getBuiltinModule('node:os');
      return { profile: app.getPath('userData'), home: builtins.homedir(),
        HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
        APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA,
        TEMP: process.env.TEMP, TMP: process.env.TMP };
    });
    expect(path.resolve(environment.userDataPath)).toBe(path.resolve(paths.profile));
    expect(path.resolve(paths.HOME!)).toBe(path.resolve(paths.home));
    expect(path.resolve(paths.USERPROFILE!)).toBe(path.resolve(paths.home));
    for (const candidate of [paths.profile, paths.APPDATA, paths.LOCALAPPDATA, paths.TEMP, paths.TMP]) {
      expect(candidate).toBeTruthy();
      expect(inside(paths.home, candidate!)).toBe(true);
    }
    // The shared fixture validates owned runtime/home roots before launch.
    attachmentPath = path.join(paths.home, 'first-user-meeting-notes.txt');
    fs.writeFileSync(attachmentPath, content, { encoding: 'utf8', flag: 'wx' });
    expect(await page.evaluate(() => window.electron.mcpListServers!())).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Welcome to HomeBot', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('homebot-app-root')).toHaveClass(/widget-mode/);
    await expect(page.locator('.mode-switcher')).toBeHidden();
    const explore = page.getByRole('button', { name: 'Explore HomeBot', exact: true });
    await visibleControl(page, explore, 'initial compact Explore HomeBot', 100, 44, bounds);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: testInfo.outputPath('first-user-compact-dark.png') });

    await explore.focus();
    await explore.press('Enter');
    await expect(page.getByTestId('homebot-app-root')).toHaveClass(/expanded-mode/);
    await expect(page.getByRole('heading', { name: 'What would you like to do?', exact: true })).toBeVisible();
    const start = page.getByRole('button', { name: 'Start with chat', exact: true });
    await visibleControl(page, start, 'Home Start with chat', 100, 44, bounds);
    await page.screenshot({ path: testInfo.outputPath('first-user-home-dark.png') });
    await start.click();
    const composer = page.getByRole('textbox', { name: 'Message HomeBot', exact: true });
    await expect(composer).toBeFocused();
    const starter = page.getByRole('button', { name: 'Draft a message', exact: true });
    const prompt = await starter.getAttribute('title');
    expect(prompt).toBeTruthy();
    await starter.focus();
    await starter.press('Enter');
    await expect(composer).toHaveValue(prompt!);
    await expect(composer).toBeFocused();
    await noSentUserMessages(page);
    await composer.fill(brief);
    await expect(composer).toHaveValue(brief);
    await noSentUserMessages(page);
    await page.getByLabel('Attach documents', { exact: true }).setInputFiles(attachmentPath);
    await expect(page.getByText('first-user-meeting-notes.txt', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What would you like to do?', exact: true })).toBeVisible();
    await expect(composer).toHaveCount(0);
    await start.click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(brief);
    await expect(page.getByRole('button', { name: 'Remove first-user-meeting-notes.txt', exact: true })).toBeVisible();
    await noSentUserMessages(page);
    await page.screenshot({ path: testInfo.outputPath('first-user-retained-draft-dark.png') });

    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.getTitle().includes('HomeBot'));
      if (!window) throw new Error('The owned HomeBot window is unavailable.');
      window.setSize(560, 760);
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.getTitle().includes('HomeBot'));
      return window?.getBounds();
    })).toMatchObject({ width: 560, height: 760 });

    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') {
        await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
        await expect(page.locator('.settings-panel')).toBeVisible();
        await page.getByRole('button', { name: 'light theme', exact: true }).click();
        await page.getByRole('button', { name: /^Save( changes)?$/ }).click();
        await expect(page.locator('.settings-panel')).toBeHidden();
        await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-theme', 'light');
        const settings = JSON.parse(fs.readFileSync(path.join(paths.profile, 'config', 'user-settings.json'), 'utf8'));
        expect(settings.theme).toBe('light');
      } else {
        await expect(page.getByTestId('homebot-app-root')).toHaveAttribute('data-theme', 'dark');
      }
      await expect(composer).toHaveValue(brief);
      await visibleControl(page, composer, `${theme} narrow message composer`, 200, 36, bounds);
      await visibleControl(page, page.getByRole('button', { name: 'Send', exact: true }), `${theme} narrow Send`, 40, 28, bounds);
      await visibleControl(page, page.getByRole('button', { name: 'Remove first-user-meeting-notes.txt', exact: true }),
        `${theme} narrow attachment remove`, 16, 16, bounds);
      await visibleControl(page, page.getByRole('button', { name: 'Set chat guidelines', exact: true }),
        `${theme} narrow guidelines`, 24, 32, bounds);
      for (const label of ['Voice conversation', 'Capture screen']) {
        const action = page.getByRole('button', { name: label, exact: true });
        await visibleControl(page, action, `${theme} narrow ${label}`, 32, 32, bounds);
        await expect.poll(() => action.evaluate(element => {
          const composer = document.querySelector('.chat-interface .input-container');
          if (!composer) return false;
          const a = element.getBoundingClientRect();
          const b = composer.getBoundingClientRect();
          return a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right;
        }), { message: `${label} must stay clear of the entire composer` }).toBe(true);
      }
      const chatLayout = await page.locator('.chat-interface').evaluate(element => {
        const edge = element.getBoundingClientRect();
        return { width: element.clientWidth, scrollWidth: element.scrollWidth,
          overflowing: Array.from(element.querySelectorAll('*')).flatMap(child => {
            const box = child.getBoundingClientRect();
            if (!box.width || !box.height || (box.left >= edge.left - 1 && box.right <= edge.right + 1)) return [];
            return [{ tag: child.tagName, classes: child.className, label: child.getAttribute('aria-label'),
              left: box.left, right: box.right, width: box.width, position: getComputedStyle(child).position }];
          }).slice(0, 50) };
      });
      fs.writeFileSync(testInfo.outputPath(`first-user-chat-layout-${theme}.json`), JSON.stringify(chatLayout, null, 2));
      expect(chatLayout.overflowing.filter(item => typeof item.classes === 'string' && item.classes.includes('daily-card'))).toEqual([]);
      await expect.poll(() => page.locator('.chat-interface').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`first-user-chat-narrow-${theme}.png`) });
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await visibleControl(page, start, `${theme} narrow Home Start`, 100, 44, bounds);
      for (const label of ['Explore workspaces', 'Check setup and available features', 'Your activity']) {
        const disclosure = page.locator('summary').filter({ hasText: label });
        // Secondary sections deliberately follow the first task in a scrollable
        // Home panel. Check their actual reachable bounds after user scrolling.
        await disclosure.scrollIntoViewIfNeeded();
        await visibleControl(page, disclosure, `${theme} narrow ${label}`, 200, 44, bounds);
      }
      await expect.poll(() => page.locator('.dashboard-container').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`first-user-home-narrow-${theme}.png`) });
      await start.click();
      await expect(composer).toHaveValue(brief);
      await expect(composer).toBeFocused();
      await expect(page.getByText('first-user-meeting-notes.txt', { exact: true })).toBeVisible();
      await noSentUserMessages(page);
    }

    const evidence = await runtime.evidence();
    expect(evidence.transport.controls).toBe(10);
    expect(evidence.transport.rendererControls).toBe(1);
    expect(evidence.transport.phase).toBe('setup');
    expect(evidence.rejected).toEqual([]);
    expect(evidence.transport.rendererDenied).toEqual([]);
    // Production supervision probes optional Qdrant; Comfy can report local
    // availability. These exact readonly probes remain blocked, not simulated.
    const readonlyBlockedUrls = new Set([
      'http://localhost:6333/', 'http://localhost:6333/healthz', 'http://127.0.0.1:4/system_stats',
    ]);
    expect(evidence.transport.denied.filter((attempt: { method?: string; url?: string }) =>
      attempt.method !== 'GET' || !readonlyBlockedUrls.has(attempt.url || ''))).toEqual([]);
    expect(evidence.transport.processAttempts.filter((attempt: { method: string; command: string; args: string[] }) =>
      attempt.method !== 'execFile' || attempt.command !== 'nvidia-smi'
      || JSON.stringify(attempt.args) !== JSON.stringify(['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']))).toEqual([]);
    expect(evidence.currentRag).toBe(evidence.initialRag);
    expect(evidence.requests.filter(request => ['/api/chat', '/api/generate', '/api/pull'].includes(request.path))).toEqual([]);
    expect(evidence.requests.filter(request => request.method !== 'GET' && !(request.method === 'POST'
      && ['/webhook/homebot/calendar', '/webhook/homebot/chat', '/webhook/homebot/media-research'].includes(request.path)
      && JSON.stringify(request.body) === '{"action":"ping"}'))).toEqual([]);
    fs.writeFileSync(testInfo.outputPath('first-user-discovery-evidence.json'), JSON.stringify({
      verification: 'Post-setup private compiled renderer, actual preload and production handlers; local startup health fixtures only.',
      setupWizardProved: false, realProviderGenerationProved: false, initialCompactPathProved: true,
      environment, paths, brief, attachment: { path: attachmentPath, sha256: createHash('sha256').update(fs.readFileSync(attachmentPath)).digest('hex') },
      visibleDraftAndAttachmentPreserved: true, autoSendObserved: false, controlBounds: bounds,
      transportAndProcessEvidence: evidence,
    }, null, 2));
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      fs.writeFileSync(testInfo.outputPath('first-user-discovery-final-diagnostic.json'), JSON.stringify({
        attachmentPath, controlBounds: bounds, evidence: await runtime.evidence(),
      }, null, 2));
    } catch (error) {
      errors.push(error);
    }
    try {
      // The external shared bootstrap owns bounded shutdown and its receipt.
      // A forced cleanup receipt must never be described as graceful shutdown.
      assertClosedReceipt(await runtime.close());
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Native discovery assertion, evidence or cleanup failures');
  }
});
