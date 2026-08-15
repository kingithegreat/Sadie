import { test, expect } from '@playwright/test';
import { launchElectronApp } from './launchElectron';
import { waitForAppReady } from './helpers/appReady';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import * as http from 'http';

const FEED_XML = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Deep Questions</title><description>Thinking clearly.</description>
<item><title>Why Attention Matters</title><description><![CDATA[<p>Guest Dr. Lee explains focus.</p>]]></description><pubDate>Mon, 11 Aug 2026 06:00:00 GMT</pubDate><itunes:duration>52:10</itunes:duration></item>
<item><title>Digital Minimalism, Revisited</title><itunes:summary>Less, but better.</itunes:summary><pubDate>Mon, 04 Aug 2026 06:00:00 GMT</pubDate></item>
</channel></rss>`;

/**
 * The "From a podcast…" source, end to end against the real app.
 *
 * The feed is served from a local HTTP server inside the test, so this cannot
 * flake on the network and needs no real podcast to exist. What it proves is
 * the part jsdom cannot: the whole chain main-process fetch → regex parser →
 * IPC → panel → ordinary job in the queue, in the packaged build.
 */
test('feed → episodes → recap job, against the real app', async () => {
  // A local feed server, so the test needs no network and cannot flake on one.
  const server = http.createServer((_q, r) => { r.setHeader('content-type','application/rss+xml'); r.end(FEED_XML); });
  await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as any).port;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-feed-'));
  const { app, page } = await launchElectronApp({ HOMEBOT_E2E: '1', NODE_ENV: 'test' }, tmp);
  await waitForAppReady(page);
  const skip = page.getByRole('button', { name: /Skip setup/i });
  try { await skip.waitFor({ state: 'visible', timeout: 8000 }); await skip.click();
        await page.locator('.first-run-overlay').waitFor({ state: 'detached', timeout: 8000 }); } catch {}

  await page.locator('.mode-btn', { hasText: 'Studio' }).first().click();
  await page.waitForTimeout(600);
  const out = path.join(process.cwd(), 'test-results', 'feed'); fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, '1-studio.png') });

  await page.getByText('From a podcast…').click();
  await page.getByLabel('Podcast feed link').fill(`http://127.0.0.1:${port}/feed.xml`);
  await page.getByText('Show episodes').click();
  await page.getByText('Why Attention Matters').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(out, '2-episodes.png') });

  await page.getByRole('button', { name: 'Make a recap' }).first().click();
  await page.waitForTimeout(800);
  // The episode became an ordinary job: same queue, same state machine, same
  // approval gate as anything created by hand.
  await expect(page.locator('.ms-job-title', { hasText: 'Recap: Why Attention Matters' })).toBeVisible();
  await page.screenshot({ path: path.join(out, '3-job.png') });

  await app.close();
  server.close();
});
