import * as fs from 'fs';
import * as path from 'path';

export const movieImageFixture = fs.readFileSync(path.join(__dirname, '../../../../resources/icon.png'));

/** Contract-only decoder double. Real decoding is covered in movie-image-output.e2e.spec.ts. */
export const movieNativeImageStub = {
  createFromBuffer: (bytes: Buffer) => ({
    isEmpty: () => !bytes.equals(movieImageFixture),
    getSize: () => ({ width: 256, height: 256 }),
  }),
};
