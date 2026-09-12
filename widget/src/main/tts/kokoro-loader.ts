import { createRequire } from 'module';

/**
 * kokoro-js 1.2.1 drops local_files_only in from_pretrained. Construct the
 * same model/tokenizer through its own Transformers runtime so the cache-only
 * policy reaches both loaders. Do not toggle a process-global network flag:
 * an overlapping model load could otherwise inherit another call's consent.
 * This compatibility adapter can go when Kokoro forwards per-load options.
 */
export async function loadKokoroForSpeech(allowDownloads: boolean) {
  // Use the Node require entry for both packages. Mixing Kokoro's ESM Tensor
  // class with a CJS model runtime can fail its instanceof checks in Electron.
  const { KokoroTTS } = require('kokoro-js') as typeof import('kokoro-js');
  // The app and Kokoro can depend on different Transformers major versions.
  const kokoroRequire = createRequire(require.resolve('kokoro-js'));
  const { StyleTextToSpeech2Model, AutoTokenizer } = kokoroRequire('@huggingface/transformers');
  const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  const localOnly = { local_files_only: !allowDownloads };
  const [model, tokenizer] = await Promise.allSettled([
    StyleTextToSpeech2Model.from_pretrained(modelId, { ...localOnly, dtype: 'q8', device: 'cpu' }),
    AutoTokenizer.from_pretrained(modelId, localOnly),
  ]);
  if (model.status === 'rejected') throw model.reason;
  if (tokenizer.status === 'rejected') {
    await model.value.dispose();
    throw tokenizer.reason;
  }
  // Node's Kokoro entry reads its voice embeddings from the installed package.
  return new KokoroTTS(model.value, tokenizer.value);
}
