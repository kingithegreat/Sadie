import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCharacterAnchors, getCharacterPoseSprite, saveCharacterAnchor } from '../ancient-pathways';

// Hand-placed `_mouth_anchors` / `_head_boxes` are Aden's work (AP CLAUDE.md:
// never overwrite). These run against a disposable fixture checkout only.
const sprite = fs.readFileSync(path.join(__dirname, '../../../resources/icon.png')); // 512×512 PNG
let apDir: string;
let charDir: string;
let manifestPath: string;
const handPlaced: [number, number, number, number] = [200, 300, 60, 40];

beforeEach(() => {
  apDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-anchor-save-'));
  charDir = path.join(apDir, 'workspace', 'branding', 'characters', 'leila');
  fs.mkdirSync(path.join(charDir, 'pose_a'), { recursive: true });
  fs.writeFileSync(path.join(charDir, 'pose_a', 'wave.png'), sprite);
  fs.writeFileSync(path.join(charDir, 'pose_a', 'point.png'), sprite);
  fs.writeFileSync(path.join(charDir, 'pose_a', 'notes.txt'), 'not an image');
  fs.writeFileSync(path.join(apDir, 'secret.png'), sprite); // exists: the escape below must be refused, not merely missing
  manifestPath = path.join(charDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    pose_a: { wave: 'pose_a/wave.png', point: 'pose_a/point.png', text: 'pose_a/notes.txt', escape: '../../../../secret.png' },
    _mouth_anchors: { pose_a: { wave: handPlaced } },
    _head_boxes: { pose_a: { wave: [150, 100, 200, 260] } },
    _mouth_anchors_suggested: { pose_a: { point: [210, 310, 50, 30] } },
  }, null, 2));
});
afterEach(() => fs.rmSync(apDir, { recursive: true, force: true }));

const manifest = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const backups = () => (fs.existsSync(path.join(charDir, '.backups')) ? fs.readdirSync(path.join(charDir, '.backups')) : []);
const save = (args: Record<string, unknown>) =>
  saveCharacterAnchor({ character: 'leila', group: 'pose_a', pose: 'wave', anchorType: 'mouth', box: [210, 310, 50, 30], ...args } as any, apDir);

test('replacing a hand-placed mouth anchor is refused without confirmation and changes nothing', async () => {
  const before = fs.readFileSync(manifestPath);
  const res = await save({});
  expect(res).toMatchObject({ ok: false, code: 'CONFIRM_OVERWRITE', existingBox: handPlaced });
  expect(fs.readFileSync(manifestPath)).toEqual(before);
  expect(backups()).toEqual([]);
});

test('with explicit confirmation it replaces the anchor after backing up the previous manifest', async () => {
  const res = await save({ confirmOverwrite: true });
  expect(res).toMatchObject({ ok: true, box: [210, 310, 50, 30] });
  expect(manifest()._mouth_anchors.pose_a.wave).toEqual([210, 310, 50, 30]);
  expect(backups()).toHaveLength(1);
  const backup = JSON.parse(fs.readFileSync(path.join(charDir, '.backups', backups()[0]), 'utf8'));
  expect(backup._mouth_anchors.pose_a.wave).toEqual(handPlaced);
});

test('a hand-placed head box is protected the same way', async () => {
  const res = await save({ anchorType: 'head', box: [140, 90, 210, 270] });
  expect(res).toMatchObject({ ok: false, code: 'CONFIRM_OVERWRITE', existingBox: [150, 100, 200, 260] });
  expect(manifest()._head_boxes.pose_a.wave).toEqual([150, 100, 200, 260]);
});

test('re-saving the identical box needs no confirmation', async () => {
  expect(await save({ box: handPlaced })).toMatchObject({ ok: true });
});

test('confirming an auto-suggestion (no hand-placed anchor yet) saves it and clears the suggestion', async () => {
  const res = await save({ pose: 'point', box: [210, 310, 50, 30] });
  expect(res).toMatchObject({ ok: true });
  expect(manifest()._mouth_anchors.pose_a.point).toEqual([210, 310, 50, 30]);
  expect(manifest()._mouth_anchors_suggested).toBeUndefined();
  expect(manifest()._mouth_anchors.pose_a.wave).toEqual(handPlaced); // untouched neighbour
});

test.each([
  ['outside the sprite', { pose: 'point', box: [480, 480, 60, 40] }, /outside the 512×512 sprite/],
  ['zero width', { pose: 'point', box: [10, 10, 0, 20] }, /positive width and height/],
  ['negative position', { pose: 'point', box: [-1, 10, 20, 20] }, /non-negative/],
  ['not numbers', { pose: 'point', box: [1, 2, 'x', 4] }, /four numbers/],
  ['a pose missing from the manifest', { pose: 'jump' }, /has no sprite/],
  ['a sprite that is not a PNG', { pose: 'text' }, /not a readable PNG/],
  ['a manifest path that escapes the character folder', { pose: 'escape' }, /has no sprite/],
  ['a traversal segment', { character: '../leila' }, /Invalid anchor arguments/],
  ['a slash in the group', { group: 'pose_a/../x' }, /Invalid anchor arguments/],
])('refuses %s without touching the manifest', async (_name, args, message) => {
  const before = fs.readFileSync(manifestPath);
  const res = await save(args);
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(message);
  expect(fs.readFileSync(manifestPath)).toEqual(before);
  expect(backups()).toEqual([]);
});

test('sprite reads refuse traversal in arguments and in manifest paths', async () => {
  expect((await getCharacterPoseSprite('leila', 'pose_a', 'wave', apDir)).ok).toBe(true);
  expect((await getCharacterPoseSprite('../leila', 'pose_a', 'wave', apDir)).ok).toBe(false);
  expect((await getCharacterPoseSprite('leila', 'pose_a', 'escape', apDir)).ok).toBe(false);
});

test('the character list reports hand-placed, suggested and missing anchors', async () => {
  const res = await getCharacterAnchors('leila', apDir);
  expect(res.ok).toBe(true);
  expect(res.characters?.[0]).toMatchObject({ slug: 'leila', totalPoses: 4, handPlacedMouthAnchors: 1, suggestedMouthAnchors: 1, missingMouthAnchors: 2 });
});
