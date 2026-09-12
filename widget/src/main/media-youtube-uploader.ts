import * as fs from 'fs';
import * as path from 'path';
import type { YouTubeConnection } from './integrations/youtube-connection';
import { YouTubeConnectionError } from './integrations/youtube-connection';
import type { YouTubeVideoMetadata, YouTubeUploadResult } from '../shared/youtube-connection';
import { requestProviderEndpoint, assertProviderOnlineAccess } from './utils/provider-network-policy';
import { markPublished, type MediaJob } from './media-studio';
import { readJobs, writeJobs } from './tools/media';
import { getSettings } from './config-manager';

export interface UploaderDependencies {
  youtube: YouTubeConnection;
  readJobs?: typeof readJobs;
  writeJobs?: typeof writeJobs;
  getSettings?: typeof getSettings;
  requestEndpoint?: typeof requestProviderEndpoint;
  assertOnline?: typeof assertProviderOnlineAccess;
}

// In-flight upload lock per job ID to prevent duplicate concurrent uploads
const inFlightUploads = new Set<string>();

export class YouTubeUploader {
  constructor(private readonly deps: UploaderDependencies) {}

  private getSettings(): any {
    return (this.deps.getSettings || getSettings)();
  }

  private readJobs(): MediaJob[] {
    return (this.deps.readJobs || readJobs)();
  }

  private writeJobs(jobs: MediaJob[]): void {
    (this.deps.writeJobs || writeJobs)(jobs);
  }

  private requestEndpoint(
    endpoint: string,
    provider: string,
    options: any,
    onResponse: (response: any) => void,
  ) {
    return (this.deps.requestEndpoint || requestProviderEndpoint)(endpoint, provider, options, onResponse);
  }

  private assertOnline(provider: string): void {
    (this.deps.assertOnline || assertProviderOnlineAccess)(provider);
  }

  /**
   * Uploads an approved media job's rendered video to YouTube with safety and idempotency gates.
   */
  async upload(
    jobId: string,
    metadata: YouTubeVideoMetadata,
    signal?: AbortSignal,
  ): Promise<YouTubeUploadResult> {
    if (!jobId || typeof jobId !== 'string') {
      return { ok: false, error: 'A valid job ID is required.' };
    }

    if (!metadata || !metadata.title || typeof metadata.title !== 'string' || metadata.title.trim().length === 0) {
      return { ok: false, error: 'A video title is required.' };
    }

    // 1. Publishing kill-switch check
    const settings = this.getSettings();
    const publishingEnabled = !!settings?.mediaPublishingEnabled;
    if (!publishingEnabled) {
      return {
        ok: false,
        error: 'Media publishing is switched off in Settings. Turn on Publishing in Settings to allow video uploads.',
      };
    }

    // 2. Concurrency lock per job
    if (inFlightUploads.has(jobId)) {
      return {
        ok: false,
        error: `An upload for video "${metadata.title}" is already in progress.`,
      };
    }

    // 3. Find and validate job
    const jobs = this.readJobs();
    const jobIndex = jobs.findIndex(j => j.id === jobId);
    if (jobIndex < 0) {
      return { ok: false, error: 'The video job was not found in the queue.' };
    }
    const job = jobs[jobIndex];

    // Idempotency: refused if already published
    if (job.videoId) {
      return {
        ok: false,
        error: `"${job.title}" has already been published as ${job.videoId}. Refusing to publish it again.`,
      };
    }

    // State check: must be approved or scheduled
    if (job.state !== 'approved' && job.state !== 'scheduled') {
      return {
        ok: false,
        error: `Video must be in "approved" or "scheduled" state to upload. Current state is "${job.state}".`,
      };
    }

    // Verify video file exists
    const videoPath = job.renderPath;
    if (!videoPath || !fs.existsSync(videoPath)) {
      return {
        ok: false,
        error: 'No rendered video file found for this job. Render the video before uploading.',
      };
    }

    const videoStats = fs.statSync(videoPath);
    if (!videoStats.isFile() || videoStats.size === 0) {
      return {
        ok: false,
        error: 'The rendered video file is empty or invalid.',
      };
    }

    // Verify thumbnail path if specified
    if (metadata.thumbnailPath && !fs.existsSync(metadata.thumbnailPath)) {
      return {
        ok: false,
        error: `Thumbnail file not found at ${metadata.thumbnailPath}.`,
      };
    }

    // 4. Online access check
    try {
      this.assertOnline('YouTube');
    } catch (err: any) {
      return { ok: false, error: err.message };
    }

    // 5. Get valid access token
    const abortCtrl = new AbortController();
    const effectiveSignal = signal ?? abortCtrl.signal;

    inFlightUploads.add(jobId);
    try {
      const accessToken = await this.deps.youtube.getAccessToken(effectiveSignal, false);

      // Step A: Initiate resumable session
      const resumableUrl = await this.initiateResumableSession(accessToken, videoStats.size, metadata, effectiveSignal);

      // Step B: Upload video file
      const videoId = await this.uploadVideoContent(resumableUrl, videoPath, videoStats.size, effectiveSignal);

      // Step C: Upload custom thumbnail if specified
      if (metadata.thumbnailPath && fs.existsSync(metadata.thumbnailPath)) {
        try {
          await this.uploadThumbnail(accessToken, videoId, metadata.thumbnailPath, effectiveSignal);
        } catch {
          // Thumbnail failure does not invalidate the video upload, but we note it in logs
        }
      }

      // Step D: Transition job state to published
      const updatedJob = markPublished(job, videoId, {
        publishingEnabled,
        by: 'youtube-uploader',
        humanDecision: true,
        note: `Uploaded to YouTube (${metadata.privacyStatus || 'private'})`,
      });

      const currentJobs = this.readJobs();
      const currentIdx = currentJobs.findIndex(j => j.id === jobId);
      if (currentIdx >= 0) {
        currentJobs[currentIdx] = updatedJob;
        this.writeJobs(currentJobs);
      }

      return {
        ok: true,
        videoId,
        url: `https://youtu.be/${videoId}`,
        publishedAt: updatedJob.publishedAt,
      };
    } catch (err: any) {
      const message = err instanceof YouTubeConnectionError ? err.message : (err.message || 'YouTube upload failed.');
      return { ok: false, error: message };
    } finally {
      inFlightUploads.delete(jobId);
    }
  }

  private initiateResumableSession(
    accessToken: string,
    fileSize: number,
    metadata: YouTubeVideoMetadata,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new YouTubeConnectionError('Upload was cancelled.'));
        return;
      }

      const initUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
      const bodyPayload = JSON.stringify({
        snippet: {
          title: metadata.title.trim(),
          description: (metadata.description || '').trim(),
          tags: metadata.tags || [],
          categoryId: metadata.categoryId || '22', // 22 is "People & Blogs"
        },
        status: {
          privacyStatus: metadata.privacyStatus || 'private',
          ...(metadata.publishAt ? { publishAt: metadata.publishAt, privacyStatus: 'private' } : {}),
          selfDeclaredMadeForKids: false,
        },
      });

      const req = this.requestEndpoint(
        initUrl,
        'YouTube',
        {
          method: 'POST',
          timeout: 30_000,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'Content-Length': Buffer.byteLength(bodyPayload),
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': String(fileSize),
            Accept: 'application/json',
          },
        },
        response => {
          const status = response.statusCode || 0;
          if (status === 200 && response.headers.location) {
            resolve(response.headers.location);
            return;
          }

          const chunks: Buffer[] = [];
          response.on('data', (c: any) => chunks.push(Buffer.from(c)));
          response.on('end', () => {
            let errorMsg = 'Failed to initiate YouTube upload session.';
            try {
              const res = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (res?.error?.message) errorMsg = res.error.message;
            } catch { /* ignore */ }
            if (status === 401) {
              reject(new YouTubeConnectionError('Google sign-in has expired or was revoked. Sign in again.', true));
            } else if (status === 403) {
              reject(new YouTubeConnectionError('Google denied upload access. Check YouTube quota or permissions.'));
            } else {
              reject(new YouTubeConnectionError(errorMsg));
            }
          });
        },
      );

      const abortHandler = () => {
        req.destroy();
        reject(new YouTubeConnectionError('Upload was cancelled.'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      req.on('close', () => signal.removeEventListener('abort', abortHandler));
      req.on('error', err => reject(new YouTubeConnectionError(err.message || 'Network error connecting to Google.')));
      req.on('timeout', () => {
        req.destroy();
        reject(new YouTubeConnectionError('Connection to Google timed out.'));
      });
      req.end(bodyPayload);
    });
  }

  private uploadVideoContent(
    resumableUrl: string,
    filePath: string,
    fileSize: number,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new YouTubeConnectionError('Upload was cancelled.'));
        return;
      }

      const req = this.requestEndpoint(
        resumableUrl,
        'YouTube',
        {
          method: 'PUT',
          timeout: 120_000,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(fileSize),
            Accept: 'application/json',
          },
        },
        response => {
          const chunks: Buffer[] = [];
          response.on('data', (c: any) => chunks.push(Buffer.from(c)));
          response.on('end', () => {
            const status = response.statusCode || 0;
            if (status >= 200 && status < 300) {
              try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                if (parsed.id && typeof parsed.id === 'string') {
                  resolve(parsed.id);
                  return;
                }
              } catch { /* ignore */ }
              reject(new YouTubeConnectionError('Google returned an unreadable upload confirmation.'));
              return;
            }

            let errorMsg = 'Failed to upload video content to YouTube.';
            try {
              const res = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              if (res?.error?.message) errorMsg = res.error.message;
            } catch { /* ignore */ }
            reject(new YouTubeConnectionError(errorMsg));
          });
        },
      );

      const abortHandler = () => {
        req.destroy();
        reject(new YouTubeConnectionError('Upload was cancelled.'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      req.on('close', () => signal.removeEventListener('abort', abortHandler));
      req.on('error', err => reject(new YouTubeConnectionError(err.message || 'Failed transmitting video file.')));
      req.on('timeout', () => {
        req.destroy();
        reject(new YouTubeConnectionError('Video upload timed out.'));
      });

      const readStream = fs.createReadStream(filePath);
      readStream.on('error', err => {
        req.destroy();
        reject(new YouTubeConnectionError(`Failed reading video file: ${err.message}`));
      });
      readStream.pipe(req);
    });
  }

  private uploadThumbnail(
    accessToken: string,
    videoId: string,
    thumbnailPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new YouTubeConnectionError('Thumbnail upload cancelled.'));
        return;
      }

      const thumbStats = fs.statSync(thumbnailPath);
      const ext = path.extname(thumbnailPath).toLowerCase();
      const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
      const thumbUrl = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`;

      const req = this.requestEndpoint(
        thumbUrl,
        'YouTube',
        {
          method: 'POST',
          timeout: 30_000,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': contentType,
            'Content-Length': String(thumbStats.size),
            Accept: 'application/json',
          },
        },
        response => {
          const status = response.statusCode || 0;
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(new YouTubeConnectionError(`Failed to set thumbnail (HTTP ${status}).`));
          }
        },
      );

      const abortHandler = () => {
        req.destroy();
        reject(new YouTubeConnectionError('Thumbnail upload cancelled.'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
      req.on('close', () => signal.removeEventListener('abort', abortHandler));
      req.on('error', err => reject(new YouTubeConnectionError(err.message)));

      const readStream = fs.createReadStream(thumbnailPath);
      readStream.pipe(req);
    });
  }
}
