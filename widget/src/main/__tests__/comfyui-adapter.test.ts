import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';

jest.mock('http');

import {
  COMFYUI_PROVIDER_ID,
  getComfyUIEndpoint,
  buildComfyUIWorkflow,
  probeComfyUI,
  generateComfyUIShot,
  comfyUIProvider,
} from '../movie/comfyui-adapter';
import { GenerationRouter } from '../movie/router';
import type { GenerationRequest } from '../movie/types';

describe('ComfyUI Local Generation Adapter', () => {
  let tmpDir: string;
  const origEnv = process.env.COMFY_ENDPOINT;

  function mockHttpSuccess(data: any = {}, statusCode = 200) {
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const mockRes: any = {
      statusCode,
      resume: jest.fn(),
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'data') cb(buf);
        if (event === 'end') cb();
        return mockRes;
      }),
    };
    const mockReq: any = {
      on: jest.fn().mockReturnThis(),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn().mockReturnThis(),
      destroy: jest.fn(),
    };
    (http.request as jest.Mock).mockImplementation((_opts: any, cb: any) => {
      if (cb) cb(mockRes);
      return mockReq;
    });
  }

  function mockHttpError(err = new Error('connect ECONNREFUSED 127.0.0.1:8188')) {
    const mockReq: any = {
      on: jest.fn((event: string, cb: Function) => {
        if (event === 'error') cb(err);
        return mockReq;
      }),
      write: jest.fn(),
      end: jest.fn(),
      setTimeout: jest.fn().mockReturnThis(),
      destroy: jest.fn(),
    };
    (http.request as jest.Mock).mockImplementation(() => mockReq);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-adapter-test-'));
    delete process.env.COMFY_ENDPOINT;
    mockHttpError();
  });

  afterEach(() => {
    if (origEnv) process.env.COMFY_ENDPOINT = origEnv;
    else delete process.env.COMFY_ENDPOINT;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const baseReq = (over: Partial<GenerationRequest> = {}): GenerationRequest => ({
    kind: 'image',
    prompt: 'A cyberpunk operative hacking an orbital uplink terminal',
    width: 1024,
    height: 576,
    shotId: 'shot_comfy_001',
    shotDir: path.join(tmpDir, 'shot_comfy_001'),
    freeOnly: true,
    allowWatermark: false,
    allowDeferred: false,
    ...over,
  });

  describe('Configuration & Workflow Builder', () => {
    test('resolves default and custom endpoints', () => {
      expect(getComfyUIEndpoint()).toBe('http://127.0.0.1:8188');
      process.env.COMFY_ENDPOINT = 'http://localhost:9999/';
      expect(getComfyUIEndpoint()).toBe('http://localhost:9999');
    });

    test('builds standard KSampler node graph', () => {
      const graph = buildComfyUIWorkflow({
        prompt: 'Epic castle at sunrise',
        negativePrompt: 'blurry, dark',
        width: 1024,
        height: 576,
        steps: 25,
        cfg: 8,
        seed: 42,
        checkpoint: 'sdxl_base.safetensors',
      });

      expect(graph['3'].class_type).toBe('KSampler');
      expect(graph['3'].inputs.steps).toBe(25);
      expect(graph['3'].inputs.cfg).toBe(8);
      expect(graph['3'].inputs.seed).toBe(42);

      expect(graph['4'].class_type).toBe('CheckpointLoaderSimple');
      expect(graph['4'].inputs.ckpt_name).toBe('sdxl_base.safetensors');

      expect(graph['5'].class_type).toBe('EmptyLatentImage');
      expect(graph['5'].inputs.width).toBe(1024);
      expect(graph['5'].inputs.height).toBe(576);

      expect(graph['6'].inputs.text).toBe('Epic castle at sunrise');
      expect(graph['7'].inputs.text).toBe('blurry, dark');
      expect(graph['9'].class_type).toBe('SaveImage');
    });
  });

  describe('Probe & Capabilities', () => {
    test('reports offline when ComfyUI server is down', async () => {
      mockHttpError();
      const cap = await probeComfyUI(baseReq());
      expect(cap.canGenerate).toBe(false);
      expect(cap.availability).toBe('offline');
      expect(cap.costMicroUsd).toBe(0);
      expect(cap.reason).toContain('ComfyUI offline / not reachable');
    });

    test('rejects resolution greater than 1536x1536', async () => {
      mockHttpSuccess();
      const cap = await probeComfyUI(baseReq({ width: 2048, height: 2048 }));
      expect(cap.canGenerate).toBe(false);
      expect(cap.reason).toContain('exceeds ComfyUI max 1536x1536');
    });

    test('honestly advertises $0 cost, multi character references, and ready status when server is up', async () => {
      mockHttpSuccess();
      const cap = await probeComfyUI(baseReq());
      expect(cap.canGenerate).toBe(true);
      expect(cap.costMicroUsd).toBe(0);
      expect(cap.availability).toBe('ready');
      expect(cap.referenceImages).toBe('multi');
      expect(cap.imageToVideo).toBe(true);
      expect(cap.watermark).toBe('none');
    });
  });

  describe('Generation & Router Integration', () => {
    test('registers cleanly in GenerationRouter and evaluates under free-first policy', async () => {
      mockHttpError();
      const router = new GenerationRouter().register(comfyUIProvider);
      expect(router.list()).toHaveLength(1);
      expect(router.list()[0].id).toBe(COMFYUI_PROVIDER_ID);

      const decision = await router.route(baseReq());
      // When offline in test, it is cleanly rejected with offline reason
      expect(decision.rejected).toHaveLength(1);
      expect(decision.rejected[0].providerId).toBe(COMFYUI_PROVIDER_ID);
      expect(decision.rejected[0].reason).toContain('offline');
    });

    test('generateComfyUIShot rejects oversize request', async () => {
      const res = await generateComfyUIShot(baseReq({ width: 2048, height: 1080 }));
      expect(res.status).toBe('failed');
      if (res.status === 'failed') {
        expect(res.error).toContain('max resolution is 1536x1536');
      }
    });

    test('generateComfyUIShot saves output image file and returns status done when successful', async () => {
      const dummyPngBinary = Buffer.from('fake-png-binary-content');

      const mockReq: any = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
        setTimeout: jest.fn().mockReturnThis(),
        destroy: jest.fn(),
      };

      (http.request as jest.Mock).mockImplementation((opts: any, cb: any) => {
        const pathStr = String(opts.path || '');
        let resData: any = {};
        if (pathStr.includes('/object_info')) {
          resData = { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['model1.safetensors']] } } } };
        } else if (pathStr.includes('/prompt')) {
          resData = { prompt_id: 'test-prompt-123' };
        } else if (pathStr.includes('/history')) {
          resData = {
            'test-prompt-123': {
              outputs: {
                '9': {
                  images: [{ filename: 'homebot_0001.png', subfolder: '', type: 'output' }],
                },
              },
            },
          };
        } else if (pathStr.includes('/view')) {
          resData = dummyPngBinary;
        }

        const buf = Buffer.isBuffer(resData) ? resData : Buffer.from(JSON.stringify(resData));
        const mockRes: any = {
          statusCode: 200,
          resume: jest.fn(),
          on: jest.fn((event: string, handler: Function) => {
            if (event === 'data') handler(buf);
            if (event === 'end') handler();
            return mockRes;
          }),
        };
        if (cb) cb(mockRes);
        return mockReq;
      });

      const shotDir = path.join(tmpDir, 'shot_001');
      const req = baseReq({ shotDir, shotId: 'shot_001' });

      const res = await generateComfyUIShot(req);
      expect(res.status).toBe('done');
      if (res.status === 'done') {
        expect(res.costMicroUsd).toBe(0);
        expect(res.files).toHaveLength(1);
      }

      // Verify file was written
      const savedPath = path.join(shotDir, 'image', 'shot_001.png');
      expect(fs.existsSync(savedPath)).toBe(true);
      expect(fs.readFileSync(savedPath).toString()).toBe('fake-png-binary-content');
    });
  });
});
