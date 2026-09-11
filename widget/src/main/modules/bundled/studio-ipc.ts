import { ipcMain as electronIpcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ToolResult } from '../../tools/types';
import type { YouTubeConnection } from '../../integrations/youtube-connection';
import type { YouTubeConnectionReply } from '../../../shared/youtube-connection';

export type StudioIpcInvokeHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => any;

export type StudioIpcGuard = (
  channel: string,
  handler: StudioIpcInvokeHandler,
) => StudioIpcInvokeHandler;

/** Register the existing Media Studio IPC surface through a host-owned guard. */
export function registerStudioIpc(
  guard: StudioIpcGuard,
  invokeTool: (event: IpcMainInvokeEvent, name: string, args: Record<string, unknown>) => Promise<ToolResult>,
  assertEnabled: () => void,
): void {
  // Keep literal ipcMain.handle calls below so the IPC/docs contract scanners see them.
  const ipcMain = {
    handle(channel: string, handler: StudioIpcInvokeHandler): void {
      electronIpcMain.handle(channel, guard(channel, handler));
    },
  };

  // Created only when the user opens this connection; no OAuth work at startup.
  let youtube: Promise<YouTubeConnection> | undefined;
  const getYouTube = () => {
    if (!youtube) youtube = (async () => {
      const { YouTubeConnection } = await import('../../integrations/youtube-connection');
      const { loadIntegrationSecret, saveIntegrationSecret } = await import('../../config-manager');
      const { assertProviderOnlineAccess } = await import('../../utils/provider-network-policy');
      const { shell } = await import('electron');
      return new YouTubeConnection({
        load: () => loadIntegrationSecret('youtube.desktop'),
        save: value => saveIntegrationSecret('youtube.desktop', value),
        assertAccess: () => { assertEnabled(); assertProviderOnlineAccess('YouTube'); },
        openBrowser: url => shell.openExternal(url),
      });
    })();
    return youtube;
  };
  const youtubeAction = async (action: (service: YouTubeConnection) => Promise<YouTubeConnectionReply> | YouTubeConnectionReply): Promise<YouTubeConnectionReply> => {
    try { return await action(await getYouTube()); }
    catch (error) {
      const { YouTubeConnectionError } = await import('../../integrations/youtube-connection');
      return { ok: false, error: error instanceof YouTubeConnectionError ? error.message : 'HomeBot could not complete that Google connection request.' };
    }
  };

  ipcMain.handle('homebot:media:youtube:status', () => youtubeAction(service => ({ ok: true, status: service.status() })));
  ipcMain.handle('homebot:media:youtube:connect', () => youtubeAction(async service => ({ ok: true, status: await service.connect() })));
  ipcMain.handle('homebot:media:youtube:refresh', () => youtubeAction(async service => ({ ok: true, status: await service.refresh() })));
  ipcMain.handle('homebot:media:youtube:cancel', () => youtubeAction(service => ({ ok: true, status: service.cancel() })));
  ipcMain.handle('homebot:media:youtube:remove', () => youtubeAction(service => ({ ok: true, status: service.remove() })));
  ipcMain.handle('homebot:media:youtube:import', () => youtubeAction(async service => {
    const { dialog } = await import('electron');
    const { isWithinHomeDir } = await import('../../utils/home-boundary');
    const { YouTubeConnectionError } = await import('../../integrations/youtube-connection');
    const choice = await dialog.showOpenDialog({ title: 'Choose Google Desktop app credentials',
      properties: ['openFile'], filters: [{ name: 'Google Desktop app JSON', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: true, cancelled: true, status: service.status() };
    assertEnabled();
    // The path comes from the owner's file picker, never from renderer input.
    const resolved = fs.realpathSync(choice.filePaths[0]);
    if (!isWithinHomeDir(resolved, fs.realpathSync(os.homedir()))) throw new YouTubeConnectionError('Choose a credentials file inside your user folder, such as Downloads.');
    const fd = fs.openSync(resolved, 'r');
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 65_536) throw new YouTubeConnectionError('Choose the small Desktop app JSON file downloaded from Google Cloud.');
      const buffer = Buffer.alloc(65_537);
      const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return { ok: true, status: service.importClient(buffer.subarray(0, count).toString('utf8')) };
    } finally { fs.closeSync(fd); }
  }));

  ipcMain.handle('homebot:media:list', async () => {
    const { readJobs } = await import('../../tools/media');
    return readJobs();
  });

  // List a podcast feed's episodes so the panel can offer "make a recap of
  // this one". Read-only: nothing is created until the user picks an episode,
  // which then goes through the ordinary homebot:media:create path — a
  // feed-sourced video faces the same approval gate as everything else.
  ipcMain.handle('homebot:media:parse-feed', async (_e, url: string) => {
    const { fetchFeedXml, parsePodcastFeed } = await import('../../podcast-feed');
    try {
      const xml = await fetchFeedXml(String(url || ''));
      const feed = parsePodcastFeed(xml, 10);
      return { ok: true, feed };
    } catch (e: any) {
      // parse/fetch errors here are already written for a person; pass through.
      const msg = e?.code === 'ECONNABORTED'
        ? 'That feed took too long to answer. Check the link, or try again in a minute.'
        : (e?.message || 'Could not read that feed.');
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('homebot:media:create', async (_e, input: any) => {
    const { readJobs, writeJobs } = await import('../../tools/media');
    const { createJob } = await import('../../media-studio');
    try {
      const job = createJob({
        title: String(input?.title || ''),
        format: input?.format === 'long' ? 'long' : 'short',
        brief: input?.brief ? String(input.brief) : undefined,
      });
      writeJobs([...readJobs(), job]);
      return { ok: true, job };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /** Shared by advance/approve/reject so the transition rules live in one place. */
  const applyMediaTransition = async (
    id: string, to: string, opts: { humanDecision?: boolean; note?: string; by: string },
  ) => {
    const { readJobs, writeJobs } = await import('../../tools/media');
    const { transition, isValidState } = await import('../../media-studio');
    const { getSettings } = await import('../../config-manager');
    // Same kill switch as the chat path — the panel must not be a way around it.
    const publishingEnabled = !!(getSettings() as any)?.mediaPublishingEnabled;
    const jobs = readJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return { ok: false, error: 'That video is no longer in the list.' };
    if (!isValidState(to)) return { ok: false, error: `"${to}" is not a pipeline stage.` };
    try {
      jobs[i] = transition(jobs[i], to as any, { ...opts, publishingEnabled });
      writeJobs(jobs);
      return { ok: true, job: jobs[i] };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  };

  // Run a long stage (script, narration) from the panel.
  //
  // These take 30-60s on a local model. Without a way to start them from the
  // UI the panel could only shuffle states, so the user pressed a button, saw
  // a state change, and had no idea whether any work had happened.
  ipcMain.handle('homebot:media:run', async (_e, id: string, action: string, opts?: { voice?: string; image?: string; visuals?: string }) => {
    const { readJobs } = await import('../../tools/media');
    const job = readJobs().find(j => j.id === id);
    if (!job) return { ok: false, error: 'That video is no longer in the list.' };

    // 'render' was missing here, which made rendering chat-only: the panel
    // could write a script and record narration, then had no button for the
    // one step that actually produces the video. A panel-first workflow that
    // dead-ends before the deliverable is not a workflow.
    const tool = action === 'render' ? 'media_render'
      : action === 'narrate' ? 'media_narrate'
      : 'media_write_script';
    try {
      const args: Record<string, unknown> = { job: job.id };
      if (action === 'narrate' && opts?.voice) args.voice = opts.voice;
      // Lets a caller render against a specific image instead of generated
      // scenes — the panel doesn't use this today, but the real-IPC QA tests
      // need a way to exercise the placeholder-detection gate without a
      // network image-generation call.
      if (action === 'render' && opts?.image) args.image = opts.image;
      if (action === 'render' && opts?.visuals) args.visuals = opts.visuals;
      if (!['render', 'narrate', 'script'].includes(action)) return { ok: false, error: 'Unknown Studio stage.' };
      const res = await invokeTool(_e, tool, args);
      return res?.success
        ? { ok: true, message: String(res.result ?? '') }
        : { ok: false, error: String(res?.error ?? 'That stage failed.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('homebot:media:advance', async (_e, id: string, to: string, note?: string) =>
    applyMediaTransition(id, to, { by: 'studio', note }));

  ipcMain.handle('homebot:media:approve', async (_e, id: string, note?: string) =>
    applyMediaTransition(id, 'approved', { by: 'human', humanDecision: true, note }));

  ipcMain.handle('homebot:media:reject', async (_e, id: string, revise: boolean, note?: string) =>
    applyMediaTransition(id, revise ? 'needs_revision' : 'rejected', { by: 'human', humanDecision: true, note }));

  // Is the video engine available, and did HomeBot install it?
  //
  // Reports `ready` from actually running the binary, not from the file being
  // present — the two came apart for sd.cpp when a rename left an exe that
  // existed and could not be used.
  ipcMain.handle('homebot:media:ffmpeg-status', async () => {
    const { findFfmpeg } = await import('../../media-render');
    const { findManagedFfmpeg, isFfmpegSetupRunning } = await import('../../ffmpeg-setup');
    const managed = findManagedFfmpeg();
    const found = await findFfmpeg(managed);
    return {
      ready: !!found,
      path: found,
      managed: !!found && found === managed,
      running: isFfmpegSetupRunning(),
      supported: process.platform === 'win32',
    };
  });

  // Download and unpack the video engine, streaming progress to the panel.
  //
  // The old copy told a non-technical user to run `winget install Gyan.FFmpeg`.
  // This is the same answer `sd-cpp-setup` gave for local image generation:
  // do it for them, and say what is happening while it runs.
  ipcMain.handle('homebot:media:ffmpeg-setup', async (e) => {
    const { runFfmpegSetup } = await import('../../ffmpeg-setup');
    const send = (p: any) => {
      try { e.sender.send('homebot:media:ffmpeg-progress', p); } catch { /* window closed mid-download */ }
    };
    try {
      const bin = await runFfmpegSetup(send);
      return { ok: true, path: bin, message: 'Ready — videos can now be made on this PC.' };
    } catch (err: any) {
      // These messages are already written for a person; pass them through.
      const message = err?.message || 'The video engine could not be set up.';
      send({ phase: 'error', note: message });
      return { ok: false, error: message };
    }
  });

  // Record that a video went out, and where.
  //
  // `markPublished` was exported, unit-tested and called by nothing: the only
  // route a user could reach was `advance(id, 'published')`, a plain transition
  // that set the state and no id. That is the failure the state machine's own
  // comment warns about — "a job that looks published and is not" — because
  // without an id there is nothing to tell the two apart, and the idempotency
  // guard (which keys on `videoId`) could never fire.
  //
  // HomeBot does not upload. There is no uploader in this codebase, and adding
  // one needs Google OAuth client credentials that are not ours to hold. So the
  // honest operation is "record that this went out, and where" — the user
  // uploads, then pastes the link back. The guard then does real work: a second
  // attempt is refused rather than silently overwriting the id of the copy
  // already online.
  ipcMain.handle('homebot:media:mark-published', async (_e, id: string, videoId: string, note?: string) => {
    const { readJobs, writeJobs } = await import('../../tools/media');
    const { markPublished } = await import('../../media-studio');
    const { getSettings } = await import('../../config-manager');
    // Same kill switch as every other route into a publishing state.
    const publishingEnabled = !!(getSettings() as any)?.mediaPublishingEnabled;
    const jobs = readJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return { ok: false, error: 'That video is no longer in the list.' };
    try {
      jobs[i] = markPublished(jobs[i], String(videoId || ''), {
        by: 'human', humanDecision: true, note, publishingEnabled,
      });
      writeJobs(jobs);
      return { ok: true, job: jobs[i] };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // Deleting was chat-only. The panel could fill the disk with renders, scene
  // images and narration and offered no way to remove any of it — so the one
  // surface that shows you the queue was the one that could not shorten it.
  // Goes through the tool handler so the containment check that keeps a bad id
  // from deleting outside the media-assets root applies here too.
  ipcMain.handle('homebot:media:delete', async (_e, id: string, keepFiles?: boolean) => {
    try {
      const res = await invokeTool(_e, 'media_delete_job',
        { job: id, keepFiles: !!keepFiles },
      );
      return res?.success
        ? { ok: true, message: String(res.result ?? '') }
        : { ok: false, error: String(res?.error ?? 'Could not delete that video.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ---- Video Editing (FFmpeg-based trim & splice) ----
  ipcMain.handle('homebot:media:trim-clip', async (_e, args: { videoPath: string; startSec: number; durationSec: number }) => {
    try {
      const res = await invokeTool(_e, 'media_trim_clip', args);
      return res?.success
        ? { ok: true, result: res.result }
        : { ok: false, error: String(res?.error ?? 'Could not trim the video.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('homebot:media:splice-video', async (_e, args: { clips: string[]; outputPath: string }) => {
    try {
      const res = await invokeTool(_e, 'media_splice_video', args);
      return res?.success
        ? { ok: true, result: res.result }
        : { ok: false, error: String(res?.error ?? 'Could not splice the videos.') };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // ---- Ancient Pathways (Animated Documentary Pipeline) ----
  ipcMain.handle('homebot:media:ancient-pathways-episodes', async () => {
    const { ANCIENT_PATHWAYS_EPISODES, resolveAncientPathwaysDir } = await import('../../ancient-pathways');
    const dir = resolveAncientPathwaysDir();
    return { ok: true, episodes: ANCIENT_PATHWAYS_EPISODES, available: !!dir, dir };
  });

  ipcMain.handle('homebot:media:ancient-pathways-status', async () => {
    const { resolveAncientPathwaysDir, checkRenderLock } = await import('../../ancient-pathways');
    const dir = resolveAncientPathwaysDir();
    if (!dir) return { ok: true, available: false, dir: null, lock: { locked: false } };
    const lock = checkRenderLock(dir);
    return { ok: true, available: true, dir, lock };
  });

  ipcMain.handle('homebot:media:ancient-pathways-doctor', async (_e, episodeId: string) => {
    const { runDoctorChecks } = await import('../../ancient-pathways');
    const result = await runDoctorChecks(episodeId);
    return { ok: true, ...result };
  });

  ipcMain.handle('homebot:media:ancient-pathways-run', async (e, episodeId: string) => {
    const {
      ANCIENT_PATHWAYS_EPISODES,
      runEpisodePipeline,
      resolveAncientPathwaysDir,
    } = await import('../../ancient-pathways');
    const { readJobs, writeJobs } = await import('../../tools/media');
    const { createJob, transition } = await import('../../media-studio');

    const ep = ANCIENT_PATHWAYS_EPISODES.find(x => x.id.toLowerCase() === String(episodeId || '').toLowerCase());
    if (!ep) return { ok: false, error: `Unknown episode '${episodeId}'.` };

    const dir = resolveAncientPathwaysDir();
    if (!dir) {
      return {
        ok: false,
        error: 'Ancient Pathways directory not found. Please ensure it is installed at Desktop/Ancient Pathways.',
      };
    }

    const jobs = readJobs();
    let job = jobs.find(j => j.title.toLowerCase().includes(ep.title.toLowerCase()) || j.title.toLowerCase().includes(ep.id));
    if (!job) {
      job = createJob({
        title: `Ancient Pathways: ${ep.title}`,
        format: 'long',
        brief: `${ep.code} · ${ep.era} · ${ep.mainCharacter}`,
      });
      jobs.push(job);
    }

    if (['idea', 'researching', 'script_draft', 'script_qa'].includes(job.state)) {
      job = transition(job, 'media_production', { by: 'studio', note: 'Running Ancient Pathways pipeline' });
    }
    writeJobs(jobs);

    const onProgress = (p: { stage: string; note: string }) => {
      try {
        e.sender.send('homebot:media:ancient-pathways-progress', {
          jobId: job.id,
          episodeId: ep.id,
          ...p,
        });
      } catch {
        /* window closed */
      }
    };

    try {
      const res = await runEpisodePipeline({
        episodeId: ep.id,
        dir,
        onProgress,
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Episode render failed.' };
      }

      const updatedJobs = readJobs();
      const idx = updatedJobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        updatedJobs[idx].renderPath = res.renderPath;
        if (updatedJobs[idx].state === 'media_production') {
          updatedJobs[idx] = transition(updatedJobs[idx], 'render_qa', {
            by: 'studio',
            note: '1080p master render complete',
          });
        }
        writeJobs(updatedJobs);
        return { ok: true, job: updatedJobs[idx], renderPath: res.renderPath };
      }

      return { ok: true, renderPath: res.renderPath };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('homebot:media:ancient-pathways-showrunner', async (e, options: {
    prompt: string;
    duration: number;
    characters: string;
    name: string;
  }) => {
    const {
      runShowrunner,
      resolveAncientPathwaysDir,
    } = await import('../../ancient-pathways');
    const { readJobs, writeJobs } = await import('../../tools/media');
    const { createJob, transition } = await import('../../media-studio');

    const dir = resolveAncientPathwaysDir();
    if (!dir) {
      return { ok: false, error: 'Ancient Pathways directory not found.' };
    }

    const job = createJob({
      title: `Production: ${options.name}`,
      format: 'long',
      brief: `Showrunner — ${options.prompt.slice(0, 120)}`,
    });
    const jobs = readJobs();
    jobs.push(job);
    writeJobs(jobs);

    const onProgress = (p: { stage: string; note: string }) => {
      try {
        e.sender.send('homebot:media:ancient-pathways-progress', {
          jobId: job.id,
          ...p,
        });
      } catch {
        /* window closed */
      }
    };

    try {
      const res = await runShowrunner({
        prompt: options.prompt,
        duration: options.duration,
        characters: options.characters,
        name: options.name,
        dir,
        onProgress,
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Showrunner failed.' };
      }

      const updatedJobs = readJobs();
      const idx = updatedJobs.findIndex(j => j.id === job.id);
      if (idx >= 0) {
        updatedJobs[idx].renderPath = res.outputPath;
        updatedJobs[idx] = transition(updatedJobs[idx], 'render_qa', {
          by: 'studio',
          note: 'Showrunner production complete',
        });
        writeJobs(updatedJobs);
        return { ok: true, job: updatedJobs[idx], renderPath: res.outputPath };
      }

      return { ok: true, renderPath: res.outputPath };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Movie Generation Router ────────────────────────────────────────────────
  // Wires MovieProjectRunner.runProject() (which uses GenerationRouter + all 5
  // providers, including the Ancient Pathways local 2D adapter) behind an IPC
  // channel reachable from the MediaStudio UI.
  ipcMain.handle('homebot:media:movie:run', async (_e, options: {
    projectDir: string;
    freeOnly?: boolean;
    allowDeferred?: boolean;
    allowWatermark?: boolean;
  }) => {
    try {
      const { MovieProjectRunner } = await import('../../movie/project-runner');
      const { isWithinHomeDir } = await import('../../utils/home-boundary');

      const homeDir = os.homedir();
      let resolved: string;
      try {
        resolved = path.resolve(options.projectDir);
      } catch {
        return { ok: false, error: 'Project directory path is invalid.' };
      }

      if (!isWithinHomeDir(resolved, homeDir)) {
        return {
          ok: false,
          error: 'The project directory must be inside your user folder.',
        };
      }

      const projectPath = path.join(resolved, 'project.json');
      if (!fs.existsSync(projectPath)) {
        return {
          ok: false,
          error: `No project.json found in ${resolved}. Create a movie project first.`,
        };
      }

      const report = await MovieProjectRunner.runProject(resolved, {
        freeOnly: options.freeOnly,
        allowDeferred: options.allowDeferred,
        allowWatermark: options.allowWatermark,
      });

      if (report.failedShots > 0) {
        const detail = report.results.find(result => result.error)?.error;
        // Keep the full routing diagnostics in the report/log. The panel should
        // lead with the action the person can take, not six probe explanations.
        const guidance = detail?.includes('needs Online access.')
          ? 'Online access is off. Turn on Online in Settings, or use a provider on this PC.'
          : detail || 'Check the project log for details.';
        return {
          ok: false,
          report,
          error: `${report.failedShots} ${report.failedShots === 1 ? 'shot' : 'shots'} failed. ${guidance}`,
        };
      }
      return { ok: true, report };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('homebot:media:movie:list-projects', async () => {
    try {
      const homeDir = os.homedir();
      const projectsRoot = path.join(homeDir, 'Desktop', 'homebot-movie-projects');
      if (!fs.existsSync(projectsRoot)) {
        return { ok: true, projects: [] };
      }
      const dirs = fs.readdirSync(projectsRoot).filter((f) => {
        const fp = path.join(projectsRoot, f);
        return fs.statSync(fp).isDirectory() && fs.existsSync(path.join(fp, 'project.json'));
      });
      const projects = dirs.map((d) => {
        const p = JSON.parse(fs.readFileSync(path.join(projectsRoot, d, 'project.json'), 'utf-8'));
        return { id: d, projectDir: path.join(projectsRoot, d), ...p };
      });
      return { ok: true, projects };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  // ── Storyboard & Visual Deck IPC Handlers ────────────────────────────────────
  ipcMain.handle('homebot:media:storyboard:create', async (_ev, args: any) => {
    const res = await invokeTool(_ev, 'media_create_storyboard', args || {});
    return { ok: res.success, result: res.result, error: res.error };
  });

  ipcMain.handle('homebot:media:storyboard:list', async (event) => {
    const res = await invokeTool(event, 'media_list_storyboards', {});
    return { ok: res.success, storyboards: (res.result as any)?.storyboards || [], error: res.error };
  });

  ipcMain.handle('homebot:media:storyboard:get', async (_ev, projectId: string) => {
    const res = await invokeTool(_ev, 'media_get_storyboard', { projectId });
    return { ok: res.success, result: res.result, error: res.error };
  });

  ipcMain.handle('homebot:media:storyboard:generate-frame', async (_ev, args: { projectId: string; sceneId?: string; shotId: string; prompt?: string }) => {
    const res = await invokeTool(_ev, 'media_generate_storyboard_frame', args || {});
    return { ok: res.success, result: res.result, error: res.error };
  });

  ipcMain.handle('homebot:media:storyboard:save', async (_ev, args: { projectId: string; sceneId?: string; shots: any[] }) => {
    try {
      const { getStoryboardsRootDir } = await import('../../tools/media-storyboard');
      const rootDir = getStoryboardsRootDir();
      const projectDir = path.join(rootDir, args.projectId);
      const sceneId = args.sceneId || 'scene_01';
      const sceneDir = path.join(projectDir, 'scenes', sceneId);

      if (!fs.existsSync(sceneDir)) {
        return { ok: false, error: `Scene directory not found: ${sceneDir}` };
      }

      const shotIds = (args.shots || []).map((s: any) => s.shotId);
      const sceneJsonPath = path.join(sceneDir, 'scene.json');
      if (fs.existsSync(sceneJsonPath)) {
        try {
          const sceneMeta = JSON.parse(fs.readFileSync(sceneJsonPath, 'utf-8'));
          sceneMeta.shots = shotIds;
          fs.writeFileSync(sceneJsonPath, JSON.stringify(sceneMeta, null, 2), 'utf-8');
        } catch { /* ignore */ }
      }

      for (const shot of (args.shots || [])) {
        const shotDir = path.join(sceneDir, shot.shotId);
        if (!fs.existsSync(shotDir)) {
          fs.mkdirSync(shotDir, { recursive: true });
          fs.mkdirSync(path.join(shotDir, 'image'), { recursive: true });
          fs.mkdirSync(path.join(shotDir, 'video'), { recursive: true });
        }

        const promptPath = path.join(shotDir, 'prompt.json');
        let promptData: any = {};
        if (fs.existsSync(promptPath)) {
          try { promptData = JSON.parse(fs.readFileSync(promptPath, 'utf-8')); } catch { /* ignore */ }
        }
        promptData.prompt = shot.prompt ?? promptData.prompt ?? '';
        promptData.framing = shot.framing ?? promptData.framing ?? 'wide';
        promptData.lens = shot.lens ?? promptData.lens ?? '35mm';
        promptData.movement = shot.movement ?? promptData.movement ?? 'static';
        promptData.durationSec = Number(shot.durationSec) || promptData.durationSec || 5;
        fs.writeFileSync(promptPath, JSON.stringify(promptData, null, 2), 'utf-8');

        if (shot.narration !== undefined) {
          fs.writeFileSync(path.join(shotDir, 'script.txt'), String(shot.narration), 'utf-8');
        }
      }

      return { ok: true, message: 'Storyboard updated successfully.' };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('homebot:media:storyboard:render', async (_ev, args: { projectId: string; sceneId?: string; motion?: boolean; burnSubtitles?: boolean }) => {
    try {
      const res = await invokeTool(_ev, 'media_render_storyboard', {
        projectId: args.projectId,
        sceneId: args.sceneId,
        motion: args.motion !== false,
        burnSubtitles: args.burnSubtitles !== false,
      });
      return res.success
        ? { ok: true, moviePath: res.result.moviePath, durationSec: res.result.durationSec, totalShots: res.result.totalShots }
        : { ok: false, error: res.error, code: res.code };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('homebot:media:storyboard:breakdown', async (_ev, args: { script: string; genre?: string; shotCount?: number; title?: string; projectId?: string; autoGenerateFrames?: boolean }) => {
    try {
      const res = await invokeTool(_ev, 'media_breakdown_script', args || {});
      if (!res.success) return { ok: false, error: res.error, code: res.code };
      const { projectId, title, genre, shots, totalDurationSec, projectDir } = res.result;
      return { ok: true, projectId, title, genre, shots, totalDurationSec, projectDir };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

}
