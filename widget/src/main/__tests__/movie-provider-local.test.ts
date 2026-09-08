/** Controlled HTTP server: exercises the real client, not a live AI provider. */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';

jest.mock('../config-manager', () => ({ getSettings: () => ({ useCustomLLM: false }) }));
import { generateComfyUIShot, probeComfyUI } from '../movie/comfyui-adapter';
import { generateLocalSD15, probeLocalSD15 } from '../movie/local-sd15-adapter';
import type { GenerationRequest } from '../movie/types';

test('Online-off generation still reaches loopback servers and saves the returned bytes', async () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-provider-loopback-'));
  const bytes = Buffer.from('controlled-local-provider-output'.repeat(8));
  const requests: Array<{ path: string; body: any }> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ path: request.url!, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null });
      const data = request.url!.startsWith('/object_info')
        ? { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fixture-model']] } } } }
        : request.url === '/prompt' ? { prompt_id: 'fixture-job' }
          : request.url!.startsWith('/history') ? { 'fixture-job': { outputs: { '9': { images: [{ filename: 'fixture.png' }] } } } }
            : request.url === '/sdapi/v1/txt2img' ? { images: [bytes.toString('base64')] } : {};
      response.end(request.url!.startsWith('/view?') ? bytes : JSON.stringify(data));
    });
  });
  const originalComfy = process.env.COMFY_ENDPOINT;
  const originalSd = process.env.LOCAL_SD_ENDPOINT;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.COMFY_ENDPOINT = endpoint;
  process.env.LOCAL_SD_ENDPOINT = `${endpoint}/sdapi/v1/txt2img`;
  const request: GenerationRequest = {
    kind: 'image', prompt: 'A private fixture', width: 512, height: 512,
    shotId: 'shot_01', shotDir: fixtureDir, freeOnly: true, allowWatermark: false, allowDeferred: false,
  };
  try {
    expect((await probeComfyUI(request)).canGenerate).toBe(true);
    const result = await generateComfyUIShot(request);
    expect(result.status).toBe('done');
    expect(fs.readFileSync(path.join(fixtureDir, 'image', 'shot_01.png'))).toEqual(bytes);
    expect((await probeLocalSD15(request)).canGenerate).toBe(true);
    expect((await generateLocalSD15(request.prompt, 512, 512)).base64).toBe(bytes.toString('base64'));
    expect(requests).toHaveLength(7);
    expect(requests.find(item => item.path === '/prompt')?.body.prompt['6'].inputs.text).toBe(request.prompt);
    expect(requests.find(item => item.path === '/sdapi/v1/txt2img')?.body.prompt).toBe(request.prompt);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (originalComfy === undefined) delete process.env.COMFY_ENDPOINT;
    else process.env.COMFY_ENDPOINT = originalComfy;
    if (originalSd === undefined) delete process.env.LOCAL_SD_ENDPOINT;
    else process.env.LOCAL_SD_ENDPOINT = originalSd;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
