// Real setup/save/model-mode/HTTP paths, with isolated fixture services.
import { test, expect, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import { openFirstUserFixture } from './first-user-native-bootstrap';

type NativeFixture = Awaited<ReturnType<typeof openFirstUserFixture>>;

async function retain(fixture: NativeFixture, testInfo: TestInfo) {
  fs.writeFileSync(testInfo.outputPath('first-user-evidence.json'), JSON.stringify(await fixture.evidence(), null, 2));
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

async function finishEvidenceAndClose(fixture: NativeFixture, testInfo: TestInfo, errors: unknown[]) {
  try { await retain(fixture, testInfo); } catch (error) { errors.push(error); }
  try { assertClosedReceipt(await fixture.close()); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Native setup assertion, evidence or cleanup failures');
}

async function assertGuard(fixture: NativeFixture) {
  const receipt = await fixture.evidence();
  expect(receipt.transport.controls).toBe(10);
  expect(receipt.transport.rendererControls).toBe(1);
  expect(receipt.rejected).toEqual([]);
  expect(receipt.transport.rendererDenied).toEqual([]);
  expect(receipt.transport.processAttempts.filter((attempt: { method: string; command: string; args: string[] }) =>
    attempt.method !== 'execFile' || attempt.command !== 'nvidia-smi'
    || JSON.stringify(attempt.args) !== JSON.stringify(['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']))).toEqual([]);
  const titleAttempts = receipt.transport.denied.filter((attempt: { method?: string; url?: string; phase?: string }) =>
    attempt.method === 'POST' && attempt.url === `${fixture.ollamaUrl}/api/generate` && attempt.phase === 'chat');
  // App requests a best-effort title after its first finished reply >=10 chars
  // (generate-title IPC). It remains blocked before HTTP, never simulated.
  expect(titleAttempts.length).toBeLessThanOrEqual(1);
  expect(receipt.requests.filter(request => request.path === '/api/generate')).toEqual([]);
  expect(receipt.transport.denied.every((attempt: { method?: string; url?: string; phase?: string }) => {
    if (titleAttempts.includes(attempt)) return true;
    if (!attempt.url || attempt.method !== 'GET') return false;
    const url = new URL(attempt.url);
    // These optional/default probes were denied before making a request. They
    // confer no permission to touch an owner service or generate anything.
    return ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === '6333' && ['/', '/healthz'].includes(url.pathname))
      || (url.hostname === '127.0.0.1' && url.port === '4' && url.pathname === '/system_stats');
  })).toBe(true);
  expect(receipt.currentRag).toBe(receipt.initialRag);
}

async function openWizard(fixture: NativeFixture, testInfo: TestInfo) {
  const { app, page } = fixture;
  const wizard = page.getByRole('dialog', { name: 'Welcome to HomeBot' });
  await expect(wizard).toBeVisible();
  expect((await page.evaluate(() => window.electron.getEnv!())).isE2E).toBe(false);
  // Keep the actual initial window screenshot; resizing must not conceal a
  // bad startup geometry when root inspects the deliverable.
  await page.screenshot({ path: testInfo.outputPath('setup-initial-window.png') });
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(700, 760); win.show(); win.focus(); });
  await page.bringToFront();
  await expect(wizard.getByRole('heading', { name: 'Welcome to HomeBot' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(wizard.getByRole('button', { name: 'Skip setup' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(wizard.getByRole('button', { name: /On this PC/ })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(wizard.getByRole('button', { name: 'Skip setup' })).toBeFocused();
  const layout = await wizard.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth,
    text: Array.from(element.querySelectorAll('h1, p, button strong')).map(child => ({ text: child.textContent, width: child.getBoundingClientRect().width })) }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.text.every(item => item.width > 40)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('setup-narrow.png') });
  return wizard;
}

async function finishLocalAndChat(fixture: NativeFixture, testInfo: TestInfo) {
  const { page } = fixture;
  await expect(page.getByText('Ollama is ready!', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select chat model' })).toHaveValue('qwen2.5:3b');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Ready to chat on this PC' });
  await expect(wizard.getByRole('heading', { name: 'Ready to chat on this PC' })).toBeFocused();
  await wizard.getByRole('button', { name: 'Get Started' }).click();
  await expect(wizard).toHaveCount(0);
  const settings = await page.evaluate(() => window.electron.getSettings());
  expect({ chatModel: settings.chatModel, uncensoredMode: settings.uncensoredMode, useCustomLLM: settings.useCustomLLM,
    customEnabled: settings.customLLM?.enabled === true }).toEqual({ chatModel: 'qwen2.5:3b', uncensoredMode: false, useCustomLLM: false, customEnabled: false });
  const saved = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
  expect(saved.chatModel).toBe('qwen2.5:3b');
  expect(saved.uncensoredMode).toBe(false);
  expect(saved.useCustomLLM).toBe(false);
  expect(await page.evaluate(() => window.electron.getUncensoredMode!())).toEqual({ enabled: false });
  expect(fixture.fixture.requests.filter(request => request.path === '/api/chat')).toEqual([]);
  await fixture.setPhase('chat');
  const input = page.getByRole('textbox', { name: 'Message HomeBot' });
  await input.fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => fixture.fixture.requests.filter(request => request.path === '/api/chat').length).toBe(1);
  await expect(page.getByText('Hello there.', { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  const chat = fixture.fixture.requests.find(request => request.path === '/api/chat')!;
  expect(chat.body).toMatchObject({ model: 'qwen2.5:3b', stream: true });
  expect(fixture.fixture.rejected).toEqual([]);
  const memoryDir = `${fixture.roots.profile}/memory/json-store`;
  await expect.poll(() => {
    if (!fs.existsSync(memoryDir)) return false;
    return fs.readdirSync(memoryDir).filter(name => name.endsWith('.json'))
      .some(name => fs.readFileSync(`${memoryDir}/${name}`, 'utf8').includes('Hello there.'));
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('setup-first-local-chat.png') });
}

test('production first-run reuses installed3B and first HTTP greeting uses that model after runtime acknowledgement', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_FIRST_USER_NATIVE !== '1', 'Opt-in private first-user proof');
  test.setTimeout(120_000);
  const fixture = await openFirstUserFixture({ testInfo, firstRun: true, inventory: 'installed' });
  const errors: unknown[] = [];
  try {
    const wizard = await openWizard(fixture, testInfo);
    await wizard.getByRole('button', { name: /On this PC/ }).click();
    await finishLocalAndChat(fixture, testInfo);
    expect(fixture.fixture.requests.filter(request => request.path === '/api/pull')).toEqual([]);
    await assertGuard(fixture);
    await fixture.page.screenshot({ path: testInfo.outputPath('setup-first-message.png') });
  } catch (error) {
    errors.push(error);
  } finally {
    await finishEvidenceAndClose(fixture, testInfo, errors);
  }
});

test('production first-run checks before consent then reaches real fixture pull, inventory refresh and local chat', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_FIRST_USER_NATIVE !== '1', 'Opt-in private first-user proof');
  test.setTimeout(120_000);
  const fixture = await openFirstUserFixture({ testInfo, firstRun: true, inventory: 'missing' });
  const errors: unknown[] = [];
  try {
    const wizard = await openWizard(fixture, testInfo);
    await wizard.getByRole('button', { name: /On this PC/ }).click();
    await expect(fixture.page.getByRole('heading', { name: 'Local Setup' })).toBeFocused();
    const download = fixture.page.getByRole('button', { name: 'Download AI', exact: true });
    await expect(download).toBeEnabled({ timeout: 20_000 });
    await expect(fixture.page.getByText(/approximately 2.0 GB/)).toBeVisible();
    await expect(fixture.page.getByText(/needs an internet connection and free disk space/)).toBeVisible();
    expect(fixture.fixture.requests.filter(request => request.path === '/api/pull')).toEqual([]);
    await fixture.page.screenshot({ path: testInfo.outputPath('setup-before-download.png') });
    await fixture.setPhase('pull');
    await download.click();
    await expect.poll(() => fixture.fixture.requests.filter(request => request.path === '/api/pull').length).toBe(1);
    await expect(fixture.page.getByText('Setting up...', { exact: true })).toBeDisabled();
    fixture.fixture.completePull();
    await finishLocalAndChat(fixture, testInfo);
    expect(fixture.fixture.requests.filter(request => request.path === '/api/pull')).toHaveLength(1);
    await assertGuard(fixture);
  } catch (error) {
    errors.push(error);
  } finally {
    await finishEvidenceAndClose(fixture, testInfo, errors);
  }
});

test('production first-run fake key prepares configuration honestly without provider traffic', async ({}, testInfo) => {
  test.skip(process.env.HOMEBOT_FIRST_USER_NATIVE !== '1', 'Opt-in private first-user proof');
  test.setTimeout(120_000);
  const fixture = await openFirstUserFixture({ testInfo, firstRun: true, inventory: 'installed' });
  const errors: unknown[] = [];
  try {
    const wizard = await openWizard(fixture, testInfo);
    await wizard.getByRole('button', { name: /Online/ }).click();
    await fixture.page.getByLabel('AI service key').fill('deliberately-invalid-fixture-key');
    await fixture.page.getByRole('button', { name: 'Prepare service' }).click();
    await expect(fixture.page.getByText(/Your key and ability to chat have not been verified/)).toBeVisible();
    await expect(fixture.page.getByText('Connected! Ready to chat.', { exact: true })).toHaveCount(0);
    await fixture.page.screenshot({ path: testInfo.outputPath('setup-cloud-prepared.png') });
    await fixture.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(fixture.page.getByRole('heading', { name: 'Ready to try a message' })).toBeFocused();
    await expect(fixture.page.getByText(/Your key has not been verified/)).toBeVisible();
    await fixture.page.screenshot({ path: testInfo.outputPath('setup-cloud-ready-unverified.png') });
    await fixture.page.getByRole('button', { name: 'Get Started' }).click();
    await expect(fixture.page.getByRole('dialog', { name: 'Ready to try a message' })).toHaveCount(0);
    const flags = await fixture.page.evaluate(async () => {
      const settings = await window.electron.getSettings();
      return { provider: settings.customLLM?.provider, useCustomLLM: settings.useCustomLLM, uncensoredMode: settings.uncensoredMode };
    });
    expect(flags).toEqual({ provider: 'groq', useCustomLLM: true, uncensoredMode: false });
    expect(fixture.fixture.requests.filter(request => request.path === '/api/chat' || request.path === '/api/pull')).toEqual([]);
    await assertGuard(fixture);
  } catch (error) {
    errors.push(error);
  } finally {
    await finishEvidenceAndClose(fixture, testInfo, errors);
  }
});
