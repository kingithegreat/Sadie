import {
  buildUnderlayerPrompt,
  extremePoseRevealCheck,
  mouthLandmark,
  renderUnderlayerGuide,
  underlayerSockets,
  UNDERLAYER_HEIGHT,
  UNDERLAYER_WIDTH,
} from '../movie/rig-part-underlayer';
import { blankImage, keyMagentaGround } from '../movie/rig-part-joints';

describe('rig under-layer', () => {
  test('guide marks committed socket centres including mouth', () => {
    const sockets = underlayerSockets();
    expect(sockets.map(s => s.id).sort()).toEqual(['hip_l', 'hip_r', 'mouth', 'shoulder_l', 'shoulder_r']);
    const mouth = mouthLandmark();
    expect(mouth.x).toBeCloseTo(UNDERLAYER_WIDTH * 0.50, 0);
    expect(mouth.y).toBeCloseTo(UNDERLAYER_HEIGHT * 0.22, 0);
    const guide = renderUnderlayerGuide();
    expect(guide.width).toBe(UNDERLAYER_WIDTH);
    expect(guide.height).toBe(UNDERLAYER_HEIGHT);
    expect(guide.data[0]).toBe(255);
    expect(guide.data[1]).toBe(0);
    expect(guide.data[2]).toBe(255);
    expect(buildUnderlayerPrompt('a bronze-age sailor').toLowerCase()).toMatch(/well|underpaint|magenta/);
  });

  test('extreme-pose reveal fails on magenta wells and passes on finished fill', () => {
    const bad = renderUnderlayerGuide();
    const sock = underlayerSockets()[0]!;
    for (let y = Math.floor(sock.centre.y - sock.radius); y <= sock.centre.y + sock.radius; y++) {
      for (let x = Math.floor(sock.centre.x - sock.radius); x <= sock.centre.x + sock.radius; x++) {
        if (x < 0 || y < 0 || x >= bad.width || y >= bad.height) continue;
        const p = (y * bad.width + x) * 4;
        bad.data[p] = 255; bad.data[p + 1] = 0; bad.data[p + 2] = 255; bad.data[p + 3] = 255;
      }
    }
    const fail = extremePoseRevealCheck(bad, null, [sock]);
    expect(fail.ok).toBe(false);
    expect(fail.detail).toMatch(/magenta/);

    const good = blankImage(UNDERLAYER_WIDTH, UNDERLAYER_HEIGHT);
    for (let i = 0; i < good.data.length; i += 4) {
      good.data[i] = 190; good.data[i + 1] = 140; good.data[i + 2] = 110; good.data[i + 3] = 255;
    }
    const pass = extremePoseRevealCheck(good, null, underlayerSockets());
    expect(pass.ok).toBe(true);
  });

  test('magenta key clears guide corners', () => {
    const guide = renderUnderlayerGuide();
    const keyed = keyMagentaGround(guide);
    expect(keyed.image.data[3]).toBe(0);
  });
});
