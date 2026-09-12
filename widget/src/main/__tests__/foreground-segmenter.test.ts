import {
  probeSegmentation,
  segmentSettingImage,
  withSegmentationLock,
} from '../tools/media-foreground-segmenter';

describe('Foreground Segmenter (RMBG-1.4 / Zero-VRAM Execution)', () => {
  it('probes available segmentation engines without throwing', async () => {
    const status = await probeSegmentation();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('engine');
  });

  it('guarantees strict sequential execution via withSegmentationLock', async () => {
    const executionOrder: number[] = [];

    const task1 = withSegmentationLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      executionOrder.push(1);
    });

    const task2 = withSegmentationLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(2);
    });

    await Promise.all([task1, task2]);
    expect(executionOrder).toEqual([1, 2]);
  });

  it('gracefully handles missing models by providing single plate fallback', async () => {
    const dummyBuffer = Buffer.from('FAKE_SETTING_IMAGE_DATA');
    const result = await segmentSettingImage(dummyBuffer, { preferCpu: true });

    expect(result.ok).toBe(true);
    expect(result.bgBuffer).toEqual(dummyBuffer);
    expect(result.fgBuffer.length).toBe(0);
    expect(result.engineUsed).toBe('single_plate_fallback');
  });
});
