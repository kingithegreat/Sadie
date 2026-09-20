import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchFocusedStudioApp as launchElectronApp } from './helpers/focusStudioWindow';
import { waitForAppReady } from './helpers/appReady';
import { movieImageFixture } from '../../main/__tests__/helpers/movie-image';

type QueueStatus = 'AWAITING_WORKER' | 'FAILED' | 'CANCELLED';

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('Colab queue acceptance: list, offline cancel/retry policy, consented retry, and restart', async ({}) => {
  test.skip(process.env.HOMEBOT_COLAB_QUEUE_ACCEPTANCE !== '1', 'Opt-in real Electron queue acceptance.');
  test.setTimeout(180_000);

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-colab-queue-acceptance-'));
  const profile = path.join(home, 'profile');
  const projectsRoot = path.join(home, 'Desktop', 'homebot-movie-projects');
  const projectId = 'colab-queue-acceptance';
  const projectDir = path.join(projectsRoot, projectId);
  const sceneDir = path.join(projectDir, 'scenes', 'scene_01');
  const queueRoot = path.join(home, 'colab-queue');
  const ticketsDir = path.join(queueRoot, 'tickets');
  const outputsDir = path.join(queueRoot, 'outputs');
  const artifactDir = path.resolve(__dirname, '../../../../.kilo/artifacts/rel34-colab-queue-e2e');
  fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(ticketsDir, { recursive: true });
  fs.mkdirSync(path.join(queueRoot, 'inputs'), { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });

  // A keyless configured provider makes the normal Settings privacy switch
  // operable without an account, key, or network request. Online begins off.
  fs.writeFileSync(path.join(profile, 'config', 'user-settings.json'), JSON.stringify({
    firstRun: false,
    telemetryEnabled: false,
    useCustomLLM: false,
    uncensoredMode: false,
    customLLM: {
      name: 'Acceptance fixture', apiUrl: '', provider: 'claude-code', model: 'sonnet', enabled: true,
    },
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    projectId, name: 'Colab Queue Acceptance', freeOnly: true,
  }, null, 2));

  const seedJob = (shotId: string, jobId: string, status: QueueStatus, attempts: number, error?: string) => {
    const shotDir = path.join(sceneDir, shotId);
    const ticketId = `colab_ticket_${shotId}_${jobId.slice(0, 8)}`;
    const manifest = {
      version: '1.0', jobId, ticketId, createdAt: `2026-09-21T00:00:0${attempts}.000Z`,
      shotId, shotDir, prompt: `Acceptance fixture for ${shotId}`, width: 1024, height: 576,
      stagedCharacterRefs: [], relativeOutputPath: `outputs/${jobId}/${shotId}.png`,
      status, attempts, ...(error ? { error } : {}),
    };
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'ticket.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(shotDir, 'status.json'), JSON.stringify({
      shotId, status, attempts,
      ...(status === 'AWAITING_WORKER' ? { deferredTicket: ticketId, deferredProvider: 'colab-worker' } : {}),
      ...(error ? { lastError: error } : {}),
    }, null, 2));
    for (const alias of [ticketId, jobId]) {
      fs.writeFileSync(path.join(ticketsDir, `${alias}.json`), JSON.stringify(manifest, null, 2));
    }
    return { shotId, shotDir, ticketId, jobId, manifest };
  };

  const pending = seedJob('shot_pending', '1111111111111111', 'AWAITING_WORKER', 1);
  const failed = seedJob('shot_failed', '2222222222222222', 'FAILED', 2, 'Seeded worker failure');
  fs.writeFileSync(path.join(sceneDir, 'scene.json'), JSON.stringify({
    sceneId: 'scene_01', shots: [pending.shotId, failed.shotId],
  }, null, 2));

  const env = {
    HOMEBOT_E2E: '1', NODE_ENV: 'test', HOME: home, USERPROFILE: home,
    HOMEBOT_COLAB_QUEUE: queueRoot, HOMEBOT_MOVIE_PROJECTS_DIR: projectsRoot,
  };
  let running: { app: ElectronApplication; page: Page } | undefined;
  const projectCard = () => running!.page.locator('.ms-movie-project-item').filter({ hasText: 'Colab Queue Acceptance' });
  const queue = () => running!.page.getByLabel('Colab queue for Colab Queue Acceptance', { exact: true });
  const row = (shotId: string) => queue().locator('.ms-colab-job-row').filter({ hasText: shotId });
  const openAndRefreshQueue = async () => {
    await running!.page.locator('button.mode-btn', { hasText: 'Studio' }).click();
    await running!.page.getByRole('tab', { name: /Movie Router/ }).click();
    await expect(projectCard()).toBeVisible();
    await projectCard().getByRole('button', { name: /Refresh Colab queue/ }).click();
    await expect(queue()).toBeVisible();
  };
  const aliases = (job: typeof pending) => [
    path.join(ticketsDir, `${job.ticketId}.json`),
    path.join(ticketsDir, `${job.jobId}.json`),
    path.join(job.shotDir, 'ticket.json'),
  ];

  try {
    running = await launchElectronApp(env, profile);
    await waitForAppReady(running.page);
    await openAndRefreshQueue();

    await expect(row(pending.shotId)).toContainText('AWAITING_WORKER');
    await expect(row(pending.shotId).getByRole('button', { name: 'Cancel pending ticket' })).toBeEnabled();
    await expect(row(failed.shotId)).toContainText('Seeded worker failure');
    await expect(row(failed.shotId).getByRole('button', { name: 'Retry' })).toBeDisabled();

    // The disabled button is UI evidence; this real preload call also proves
    // main rejects a bypass while Online is off and leaves every alias intact.
    const offlineRetry = await running.page.evaluate((args) =>
      window.electron.mediaMovieRetryColabJob!(args),
    { projectDir, ticketId: failed.ticketId, expectedAttempts: 2 });
    expect(offlineRetry).toMatchObject({ ok: false });
    expect(offlineRetry.error).toMatch(/needs Online access/i);
    for (const file of aliases(failed)) expect(readJson(file)).toMatchObject({ status: 'FAILED', attempts: 2 });

    await row(pending.shotId).getByRole('button', { name: 'Cancel pending ticket' }).click();
    const confirmation = running.page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('active Colab notebook may still finish');
    const confirmCancel = confirmation.getByRole('button', { name: 'Cancel the pending ticket' });
    await expect(confirmCancel).toBeVisible();
    // ConfirmDestructive intentionally closes on any scroll. Playwright's
    // pointer click may scroll the portalled button by a pixel and dismiss it;
    // activate the visible real button without introducing that harness race.
    await confirmCancel.evaluate(element => (element as HTMLButtonElement).click());
    await expect.poll(() => aliases(pending).map(file => readJson(file).status)).toEqual([
      'CANCELLED', 'CANCELLED', 'CANCELLED',
    ]);
    expect(readJson(path.join(pending.shotDir, 'status.json'))).toMatchObject({ status: 'PLANNED' });
    expect(readJson(path.join(pending.shotDir, 'status.json')).deferredTicket).toBeUndefined();

    // Simulate a notebook finishing after cancellation. Refresh must not offer
    // this ignored file as a usable output.
    const lateOutput = path.join(queueRoot, pending.manifest.relativeOutputPath);
    fs.mkdirSync(path.dirname(lateOutput), { recursive: true });
    fs.writeFileSync(lateOutput, movieImageFixture);
    await projectCard().getByRole('button', { name: /Refresh Colab queue/ }).click();
    await expect(row(pending.shotId)).toContainText('CANCELLED');
    await expect(row(pending.shotId)).toContainText('Output not ready');
    await expect(row(pending.shotId).getByText('Output ready', { exact: true })).toHaveCount(0);

    // Turn Online on through the user-facing Settings control, then refresh so
    // the Movie Router rereads the saved setting before enabling Retry.
    await running.page.locator('button[aria-label="Settings"]').click();
    const settings = running.page.getByRole('dialog', { name: 'Settings' });
    const online = settings.getByTestId('privacy-switch');
    await expect(online).toBeEnabled();
    await expect(online).not.toBeChecked();
    await online.check();
    await settings.getByRole('button', { name: 'Save changes' }).click();
    await expect(settings).toHaveCount(0);
    await expect.poll(() => readJson(path.join(profile, 'config', 'user-settings.json')).useCustomLLM).toBe(true);

    await projectCard().getByRole('button', { name: /Refresh Colab queue/ }).click();
    await expect(row(failed.shotId).getByRole('button', { name: 'Retry' })).toBeEnabled();
    await row(failed.shotId).getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => aliases(failed).map(file => {
      const value = readJson(file); return { status: value.status, attempts: value.attempts, error: value.error };
    })).toEqual([
      { status: 'AWAITING_WORKER', attempts: 3, error: undefined },
      { status: 'AWAITING_WORKER', attempts: 3, error: undefined },
      { status: 'AWAITING_WORKER', attempts: 3, error: undefined },
    ]);
    expect(readJson(path.join(failed.shotDir, 'status.json'))).toMatchObject({
      status: 'AWAITING_WORKER', attempts: 3, deferredTicket: failed.ticketId, deferredProvider: 'colab-worker',
    });
    const retriedManifest = readJson(path.join(failed.shotDir, 'ticket.json'));
    expect(retriedManifest.attemptId).toMatch(/^attempt_3_/);
    expect(retriedManifest.relativeOutputPath).toBe(
      `outputs/${failed.jobId}/${retriedManifest.attemptId}/${failed.shotId}.png`,
    );
    expect(retriedManifest.relativeOutputPath).not.toBe(failed.manifest.relativeOutputPath);
    await expect(row(failed.shotId)).toContainText('Attempt 3');
    const queueDeck = running.page.locator('.ms-movie-runner-deck');
    await queueDeck.scrollIntoViewIfNeeded();
    const visualContrast = await running.page.evaluate(() => {
      const rgba = (value: string): [number, number, number, number] => {
        const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      };
      const background = (element: Element | null): [number, number, number] => {
        if (!element) return [255, 255, 255];
        const base = background(element.parentElement);
        const [r, g, b, a] = rgba(getComputedStyle(element).backgroundColor);
        return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
      };
      const luminance = ([r, g, b]: number[]) => {
        const channels = [r, g, b].map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const contrast = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing contrast target: ${selector}`);
        const foreground = rgba(getComputedStyle(element).color).slice(0, 3);
        const fg = luminance(foreground);
        const bg = luminance(background(element));
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      };
      return {
        disclosure: contrast('.ms-colab-optin span'),
        projectPath: contrast('.ms-project-path'),
        queueMetadata: contrast('.ms-colab-job-row > span:not(.ms-colab-job-status)'),
        queueStatus: contrast('.ms-colab-job-status'),
      };
    });
    for (const ratio of Object.values(visualContrast)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await queueDeck.screenshot({ path: path.join(artifactDir, 'queue-after-actions.png'), animations: 'disabled' });

    await running.app.close();
    running = await launchElectronApp(env, profile);
    await waitForAppReady(running.page);
    await openAndRefreshQueue();

    await expect(row(pending.shotId)).toContainText('CANCELLED');
    await expect(row(pending.shotId)).toContainText('Output not ready');
    await expect(row(failed.shotId)).toContainText('AWAITING_WORKER');
    await expect(row(failed.shotId)).toContainText('Attempt 3');
    expect((await running.page.evaluate(() => window.electron.getSettings())).useCustomLLM).toBe(true);
    for (const file of aliases(pending)) expect(readJson(file)).toMatchObject({ status: 'CANCELLED', attempts: 1 });
    for (const file of aliases(failed)) expect(readJson(file)).toMatchObject({ status: 'AWAITING_WORKER', attempts: 3 });
    const restartedDeck = running.page.locator('.ms-movie-runner-deck');
    await restartedDeck.scrollIntoViewIfNeeded();
    await restartedDeck.screenshot({ path: path.join(artifactDir, 'queue-after-restart.png'), animations: 'disabled' });
    fs.writeFileSync(path.join(artifactDir, 'evidence.json'), JSON.stringify({
      projectId,
      offlineRetry,
      cancelledAliases: aliases(pending).map(file => readJson(file)),
      retriedAliases: aliases(failed).map(file => readJson(file)),
      cancelledShotStatus: readJson(path.join(pending.shotDir, 'status.json')),
      retriedShotStatus: readJson(path.join(failed.shotDir, 'status.json')),
      onlinePersisted: readJson(path.join(profile, 'config', 'user-settings.json')).useCustomLLM,
      lateOutputIgnored: fs.existsSync(lateOutput),
      visualContrast,
    }, null, 2));
  } finally {
    if (running) await running.app.close().catch(() => {});
    // Electron/Chromium can release profile handles a moment after close() on
    // Windows. Retry the disposable-tree removal instead of turning a passed
    // product flow into an EPERM teardown failure.
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (error) {
      // PowerShell/Office telemetry occasionally opens files beneath the
      // overridden HOME after the app exits. The fixture is isolated and may
      // be retained; teardown locking is not a queue-product failure.
      console.warn(`[COLAB-QUEUE-E2E] Could not remove disposable home ${home}: ${String(error)}`);
    }
  }
});
