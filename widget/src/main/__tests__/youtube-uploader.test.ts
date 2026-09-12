/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YouTubeUploader } from '../media-youtube-uploader';
import type { MediaJob } from '../media-studio';

describe('YouTubeUploader', () => {
  let tmpDir: string;
  let sampleVideoPath: string;
  let sampleThumbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-yt-test-'));
    sampleVideoPath = path.join(tmpDir, 'test_video.mp4');
    fs.writeFileSync(sampleVideoPath, Buffer.from('fake-video-bytes-mp4'));
    sampleThumbPath = path.join(tmpDir, 'thumb.jpg');
    fs.writeFileSync(sampleThumbPath, Buffer.from('fake-thumb-jpg'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  function makeJob(overrides: Partial<MediaJob> = {}): MediaJob {
    return {
      id: 'job_test_123',
      title: 'Ancient Egypt Mysteries',
      format: 'short',
      state: 'approved',
      renderPath: sampleVideoPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      ...overrides,
    };
  }

  function createMockDeps(job: MediaJob, settingsOverrides: any = { mediaPublishingEnabled: true }) {
    let currentJobs = [job];
    const mockTokens = 'mock-access-token-123';

    const mockYouTube = {
      getAccessToken: jest.fn().mockResolvedValue(mockTokens),
    } as any;

    const mockReadJobs = jest.fn(() => currentJobs);
    const mockWriteJobs = jest.fn((jobs: MediaJob[]) => {
      currentJobs = jobs;
    });

    const mockGetSettings = jest.fn(() => settingsOverrides);
    const mockAssertOnline = jest.fn();

    // Mock HTTP request function
    const mockRequest = jest.fn((endpoint: string, _provider: string, _options: any, onResponse: any) => {
      const emitter = new (require('stream').PassThrough)();
      emitter.destroy = jest.fn();

      const response = new (require('events').EventEmitter)();

      process.nextTick(() => {
        if (endpoint.includes('uploadType=resumable')) {
          // Resumable init response
          response.statusCode = 200;
          response.headers = {
            location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=resumable_session_999',
          };
          onResponse(response);
          response.emit('end');
        } else if (endpoint.includes('upload_id=resumable_session_999')) {
          // Video binary upload response
          response.statusCode = 200;
          response.headers = {};
          onResponse(response);
          response.emit('data', Buffer.from(JSON.stringify({ id: 'yt_vid_abc777' })));
          response.emit('end');
        } else if (endpoint.includes('thumbnails/set')) {
          // Thumbnail upload response
          response.statusCode = 200;
          response.headers = {};
          onResponse(response);
          response.emit('end');
        } else {
          response.statusCode = 404;
          onResponse(response);
          response.emit('end');
        }
      });

      return emitter;
    });

    const uploader = new YouTubeUploader({
      youtube: mockYouTube,
      readJobs: mockReadJobs,
      writeJobs: mockWriteJobs,
      getSettings: mockGetSettings,
      requestEndpoint: mockRequest as any,
      assertOnline: mockAssertOnline,
    });

    return {
      uploader,
      mockYouTube,
      mockReadJobs,
      mockWriteJobs,
      mockGetSettings,
      mockAssertOnline,
      mockRequest,
      getCurrentJobs: () => currentJobs,
    };
  }

  test('refuses upload when mediaPublishingEnabled is false (kill switch)', async () => {
    const job = makeJob();
    const { uploader, mockRequest } = createMockDeps(job, { mediaPublishingEnabled: false });

    const result = await uploader.upload(job.id, { title: 'Test Video' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/switched off in Settings/i);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('refuses upload if job already has a videoId (idempotency)', async () => {
    const job = makeJob({ videoId: 'existing_yt_123' });
    const { uploader, mockRequest } = createMockDeps(job);

    const result = await uploader.upload(job.id, { title: 'Test Video' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been published as existing_yt_123/i);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('refuses upload if job is not in approved or scheduled state', async () => {
    const job = makeJob({ state: 'awaiting_approval' });
    const { uploader, mockRequest } = createMockDeps(job);

    const result = await uploader.upload(job.id, { title: 'Test Video' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must be in "approved" or "scheduled" state/i);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('refuses upload if rendered video file does not exist', async () => {
    const job = makeJob({ renderPath: path.join(tmpDir, 'non_existent.mp4') });
    const { uploader, mockRequest } = createMockDeps(job);

    const result = await uploader.upload(job.id, { title: 'Test Video' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No rendered video file found/i);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test('refuses concurrent upload for the same job ID', async () => {
    const job = makeJob();
    const { uploader, mockRequest } = createMockDeps(job);

    // Make the first request hang to simulate in-flight
    mockRequest.mockImplementationOnce(() => {
      const emitter = new (require('events').EventEmitter)();
      emitter.destroy = jest.fn();
      return emitter;
    });

    // Start first upload without awaiting
    const firstPromise = uploader.upload(job.id, { title: 'First Upload' });
    void firstPromise;

    // Second upload should immediately fail with concurrency lock
    const secondResult = await uploader.upload(job.id, { title: 'Second Upload' });

    expect(secondResult.ok).toBe(false);
    expect(secondResult.error).toMatch(/already in progress/i);
  });

  test('successful video and thumbnail upload transitions job to published', async () => {
    const job = makeJob();
    const { uploader, mockRequest, getCurrentJobs } = createMockDeps(job);

    const result = await uploader.upload(job.id, {
      title: 'Ancient Egypt Secrets',
      description: 'Documentary on ancient pyramids',
      tags: ['history', 'egypt'],
      privacyStatus: 'unlisted',
      thumbnailPath: sampleThumbPath,
    });

    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('yt_vid_abc777');
    expect(result.url).toBe('https://youtu.be/yt_vid_abc777');
    expect(result.publishedAt).toBeDefined();

    // Verify job in database is marked published
    const updatedJob = getCurrentJobs()[0];
    expect(updatedJob.state).toBe('published');
    expect(updatedJob.videoId).toBe('yt_vid_abc777');
    expect(updatedJob.publishedAt).toBeDefined();

    // 3 calls: init, upload, thumbnail
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  test('successful video upload without thumbnail skips thumbnail call', async () => {
    const job = makeJob();
    const { uploader, mockRequest, getCurrentJobs } = createMockDeps(job);

    const result = await uploader.upload(job.id, {
      title: 'No Thumb Video',
      privacyStatus: 'private',
    });

    expect(result.ok).toBe(true);
    expect(result.videoId).toBe('yt_vid_abc777');
    expect(getCurrentJobs()[0].state).toBe('published');
    // 2 calls: init, upload
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  test('handles Google 401 error gracefully', async () => {
    const job = makeJob();
    const { uploader, mockRequest } = createMockDeps(job);

    mockRequest.mockImplementationOnce((_endpoint: string, _provider: string, _options: any, onResponse: any) => {
      const emitter = new (require('stream').PassThrough)();
      emitter.destroy = jest.fn();
      const response = new (require('events').EventEmitter)();
      process.nextTick(() => {
        response.statusCode = 401;
        onResponse(response);
        response.emit('data', Buffer.from(JSON.stringify({ error: { message: 'Invalid credentials' } })));
        response.emit('end');
      });
      return emitter;
    });

    const result = await uploader.upload(job.id, { title: 'Test Video' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Google sign-in has expired or was revoked/i);
  });
});
