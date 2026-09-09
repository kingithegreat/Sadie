#!/usr/bin/env node
// Opt-in real Kokoro/Transformers smoke test. Never permits network access.
// Run from widget: node scripts/check-speech-offline.cjs [--empty-cache]
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const outputDir = path.resolve('test-results/speech-privacy');
fs.mkdirSync(outputDir, { recursive: true });
let networkAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('Unexpected outbound speech request'); };
globalThis.fetch = async () => denyNetwork();
for (const moduleName of ['http', 'https']) {
  const transport = require(moduleName);
  transport.request = denyNetwork;
  transport.get = denyNetwork;
}
// Prove every trap observes an attempted request before trusting a zero.
const controls = [() => globalThis.fetch('https://speech-control.invalid')];
for (const name of ['http', 'https']) {
  for (const method of ['request', 'get']) controls.push(() => require(name)[method]('https://speech-control.invalid'));
}
const runtime = createRequire(require.resolve('kokoro-js'))('@huggingface/transformers');
const emptyCache = process.argv.includes('--empty-cache');
if (emptyCache) {
  const isolatedCache = fs.mkdtempSync(path.join(outputDir, 'empty-cache-'));
  runtime.env.cacheDir = isolatedCache;
  runtime.env.localModelPath = isolatedCache;
}

function measureWav(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV');
  let format, channels, rate, bits, data;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > wav.length) throw new Error('Truncated WAV');
    if (id === 'fmt ') {
      format = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      rate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    }
    if (id === 'data') data = wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!data?.length || !rate || !channels || !bits) throw new Error('Missing audio');
  const bytesPerSample = bits / 8;
  const count = data.length / bytesPerSample;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const value = format === 3 && bits === 32 ? data.readFloatLE(i * bytesPerSample)
      : format === 1 && bits === 16 ? data.readInt16LE(i * bytesPerSample) / 32768 : NaN;
    if (!Number.isFinite(value)) throw new Error('Invalid or unsupported audio samples');
    sum += value * value;
  }
  const seconds = count / channels / rate;
  const rms = Math.sqrt(sum / count);
  if (seconds < 1 || seconds > 20 || rms < 0.001) throw new Error('Speech is silent or has an invalid duration');
  return { format, channels, sampleRate: rate, bits, seconds, rms };
}

(async () => {
  for (const invoke of controls) { try { await invoke(); } catch { /* Expected denial. */ } }
  if (networkAttempts !== controls.length) throw new Error('Network traps failed their positive controls');
  networkAttempts = 0;
  const { loadKokoroForSpeech } = require('../src/main/tts/kokoro-loader.ts');
  let tts;
  let report;
  const start = Date.now();
  try {
    tts = await loadKokoroForSpeech(false);
    if (emptyCache) throw new Error('An empty cache unexpectedly loaded a model');
    const audio = await tts.generate('This narration was generated on this PC without contacting an online service.', { voice: 'af_heart', speed: 1 });
    const wav = Buffer.from(audio.toWav());
    const output = path.join(outputDir, 'offline-narration.wav');
    const measurements = measureWav(wav);
    fs.writeFileSync(output, wav);
    report = { outcome: 'cached_local_speech', output, bytes: wav.length, sha256: crypto.createHash('sha256').update(wav).digest('hex'), ...measurements };
  } catch (error) {
    if (!emptyCache || !/local_files_only|not found locally/i.test(String(error))) throw error;
    report = { outcome: 'missing_cache_denied', error: String(error) };
  } finally {
    if (tts) await tts.model.dispose();
  }
  if (networkAttempts !== 0) throw new Error(`${networkAttempts} unexpected outbound requests attempted`);
  report = { ...report, networkAttempts, elapsedMs: Date.now() - start, node: process.version, platform: process.platform };
  fs.writeFileSync(path.join(outputDir, emptyCache ? 'empty-cache.json' : 'cached-speech.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
