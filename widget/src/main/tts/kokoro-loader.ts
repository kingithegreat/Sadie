import { createRequire } from 'module';
import { app } from 'electron';
import * as path from 'path';

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
  // Transformers defaults to a cache beside its installed module. In a package
  // that is inside read-only app.asar, so downloaded voices cannot persist.
  // Keep this per-load, like consent; do not mutate the shared runtime's env.
  const loadOptions = {
    local_files_only: !allowDownloads,
    cache_dir: path.join(app.getPath('userData'), 'models', 'kokoro'),
  };
  const [model, tokenizer] = await Promise.allSettled([
    StyleTextToSpeech2Model.from_pretrained(modelId, { ...loadOptions, dtype: 'q8', device: 'cpu' }),
    AutoTokenizer.from_pretrained(modelId, loadOptions),
  ]);
  if (model.status === 'rejected') throw model.reason;
  if (tokenizer.status === 'rejected') {
    await model.value.dispose();
    throw tokenizer.reason;
  }
  // Node's Kokoro entry reads its voice embeddings from the installed package.
  return new KokoroTTS(model.value, tokenizer.value);
}
