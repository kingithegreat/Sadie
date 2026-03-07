/** @jest-environment jsdom */
/**
 * image-utils.test.ts
 * Tests for src/renderer/utils/imageUtils.ts
 * Mocks FileReader, Image, and HTMLCanvasElement for jsdom compatibility.
 */

import { resizeImageFile } from '../utils/imageUtils';

// --------------------------------
// Helpers
// --------------------------------
function makeFile(name: string, type: string): File {
  return new File([new Uint8Array(10)], name, { type });
}

// Controllable image dimensions for mocking
let mockImageWidth = 200;
let mockImageHeight = 100;

// --------------------------------
// jsdom shim setup
// --------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  mockImageWidth = 200;
  mockImageHeight = 100;

  // -- FileReader mock --
  // jsdom's FileReader.readAsDataURL does not fire synchronously with fake Files,
  // so we replace it with one that resolves immediately with a predictable data URL.
  class FakeFileReader {
    onload: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    result: string | null = null;

    readAsDataURL(file: File) {
      const type = (file as File).type || 'image/jpeg';
      this.result = `data:${type};base64,/9j/mockimagedata`;
      const self = this;
      setTimeout(() => {
        self.onload?.({ target: self } as any);
      }, 0);
    }
  }
  Object.defineProperty(global, 'FileReader', { writable: true, value: FakeFileReader });

  // -- Image mock --
  // jsdom's HTMLImageElement never fires onload for data-URLs in a test context.
  Object.defineProperty(global, 'Image', {
    writable: true,
    value: class FakeImage {
      onload: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      // Width/height are read after onload fires — pick up current mock values.
      get width() { return mockImageWidth; }
      get height() { return mockImageHeight; }
      private _src = '';
      get src() { return this._src; }
      set src(v: string) {
        this._src = v;
        setTimeout(() => this.onload?.(), 0);
      }
    },
  });

  // -- Canvas mock --
  // jsdom provides the element but not the 2D rendering context or toBlob.
  const mockCtx = { drawImage: jest.fn() };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    writable: true,
    value: jest.fn(() => mockCtx),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    writable: true,
    value: jest.fn((cb: (b: Blob | null) => void, type?: string) => {
      cb(new Blob(['imgdata'], { type: type || 'image/jpeg' }));
    }),
  });
});

// --------------------------------
// Tests
// --------------------------------
describe('resizeImageFile — return shape', () => {
  test('returns filename from the original file', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(result.filename).toBe('photo.jpg');
  });

  test('returns mimeType string', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(typeof result.mimeType).toBe('string');
  });

  test('returns base64 data string (no comma)', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(result.data).not.toContain(',');
  });

  test('returns url starting with data:', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(result.url).toMatch(/^data:/);
  });

  test('returns numeric size', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(typeof result.size).toBe('number');
  });
});

describe('resizeImageFile — mime type selection', () => {
  test('uses image/jpeg for JPEG input (no transparency)', async () => {
    const result = await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    expect(result.mimeType).toBe('image/jpeg');
  });

  test('uses image/png for PNG input (preserves transparency)', async () => {
    const result = await resizeImageFile(makeFile('icon.png', 'image/png'));
    expect(result.mimeType).toBe('image/png');
  });

  test('uses image/png for WebP input (preserves transparency)', async () => {
    const result = await resizeImageFile(makeFile('anim.webp', 'image/webp'));
    expect(result.mimeType).toBe('image/png');
  });

  test('uses image/jpeg for GIF when not png/webp', async () => {
    const result = await resizeImageFile(makeFile('img.gif', 'image/gif'));
    expect(result.mimeType).toBe('image/jpeg');
  });
});

describe('resizeImageFile — resize logic', () => {
  test('does NOT resize image already within bounds', async () => {
    mockImageWidth = 100;
    mockImageHeight = 50;
    const ctx = (HTMLCanvasElement.prototype.getContext as jest.Mock)();
    await resizeImageFile(makeFile('small.jpg', 'image/jpeg'), { maxWidth: 1600, maxHeight: 1600 });
    // drawImage should be called with original 100x50
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0, 0, 100, 50
    );
  });

  test('scales down oversized width while preserving aspect ratio', async () => {
    mockImageWidth = 3200;
    mockImageHeight = 800;
    const ctx = (HTMLCanvasElement.prototype.getContext as jest.Mock)();
    await resizeImageFile(makeFile('wide.jpg', 'image/jpeg'), { maxWidth: 1600, maxHeight: 1600 });
    // widthRatio=0.5, heightRatio=2 → ratio=0.5 → 1600x400
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 400);
  });

  test('scales down oversized height while preserving aspect ratio', async () => {
    mockImageWidth = 800;
    mockImageHeight = 3200;
    const ctx = (HTMLCanvasElement.prototype.getContext as jest.Mock)();
    await resizeImageFile(makeFile('tall.jpg', 'image/jpeg'), { maxWidth: 1600, maxHeight: 1600 });
    // widthRatio=2, heightRatio=0.5 → ratio=0.5 → 400x1600
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 400, 1600);
  });
});

describe('resizeImageFile — error paths', () => {
  test('throws when canvas 2D context is unavailable', async () => {
    (HTMLCanvasElement.prototype.getContext as jest.Mock).mockReturnValue(null);
    await expect(resizeImageFile(makeFile('photo.jpg', 'image/jpeg')))
      .rejects.toThrow('Unable to get canvas context');
  });

  test('throws when toBlob returns null', async () => {
    (HTMLCanvasElement.prototype.toBlob as jest.Mock).mockImplementation(
      (cb: (b: Blob | null) => void) => cb(null)
    );
    await expect(resizeImageFile(makeFile('photo.jpg', 'image/jpeg')))
      .rejects.toThrow('Canvas toBlob returned null');
  });
});

describe('resizeImageFile — options', () => {
  test('uses default quality of 0.8 when not specified', async () => {
    await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'));
    // Third argument to toBlob should be the quality value = 0.8
    const toBlob = HTMLCanvasElement.prototype.toBlob as jest.Mock;
    expect(toBlob.mock.calls[0][2]).toBe(0.8);
  });

  test('passes custom quality to toBlob', async () => {
    await resizeImageFile(makeFile('photo.jpg', 'image/jpeg'), { quality: 0.5 });
    const toBlob = HTMLCanvasElement.prototype.toBlob as jest.Mock;
    expect(toBlob.mock.calls[0][2]).toBe(0.5);
  });
});
