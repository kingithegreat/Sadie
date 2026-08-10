/**
 * The change log is what makes "review what HomeBot edited" possible, so the
 * rules that matter are: it never breaks the write it observes, it never
 * grows without bound, and it does not fill the review list with noise.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { captureBefore, recordChange, listChanges, getChange, clearChanges } from '../file-change-log';

let dir: string;
const file = () => path.join(dir, 'sample.txt');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-changes-'));
  clearChanges();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('captureBefore', () => {
  it('reports a missing file as a creation, not an error', () => {
    const r = captureBefore(path.join(dir, 'nope.txt'));
    expect(r).toEqual({ text: '', existed: false, tooLarge: false });
  });

  it('reads existing content', () => {
    fs.writeFileSync(file(), 'hello');
    expect(captureBefore(file())).toMatchObject({ text: 'hello', existed: true });
  });

  it('flags an oversized file instead of loading it into memory', () => {
    fs.writeFileSync(file(), 'x'.repeat(1_000_001));
    const r = captureBefore(file());
    expect(r.tooLarge).toBe(true);
    expect(r.text).toBe('');
    expect(r.existed).toBe(true);
  });

  it('treats a directory as not-a-file rather than throwing', () => {
    expect(captureBefore(dir).existed).toBe(false);
  });
});

describe('recordChange', () => {
  it('records an edit with before and after', () => {
    fs.writeFileSync(file(), 'v2');
    recordChange({ path: file(), before: 'v1', existed: true, tool: 'write_file' });

    const rows = listChanges();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: file(), tool: 'write_file', created: false });

    const full = getChange(rows[0].id)!;
    expect(full.before).toBe('v1');
    expect(full.after).toBe('v2');
  });

  it('marks a new file as created', () => {
    fs.writeFileSync(file(), 'fresh');
    recordChange({ path: file(), before: '', existed: false, tool: 'write_file' });
    expect(listChanges()[0].created).toBe(true);
  });

  it('ignores a no-op write — identical bytes are not a change worth reviewing', () => {
    fs.writeFileSync(file(), 'same');
    recordChange({ path: file(), before: 'same', existed: true, tool: 'write_file' });
    expect(listChanges()).toHaveLength(0);
  });

  it('still records when a new file is written with empty content', () => {
    // created + empty is a real event: the file now exists.
    fs.writeFileSync(file(), '');
    recordChange({ path: file(), before: '', existed: false, tool: 'write_file' });
    expect(listChanges()).toHaveLength(1);
  });

  it('lists newest first', () => {
    for (const v of ['a', 'b', 'c']) {
      fs.writeFileSync(file(), v);
      recordChange({ path: file(), before: `pre-${v}`, existed: true, tool: 'write_file' });
    }
    const rows = listChanges();
    expect(getChange(rows[0].id)!.after).toBe('c');
  });

  it('is bounded — an agent editing all day cannot grow it forever', () => {
    for (let i = 0; i < 80; i++) {
      fs.writeFileSync(file(), `v${i}`);
      recordChange({ path: file(), before: `p${i}`, existed: true, tool: 'write_file' });
    }
    expect(listChanges().length).toBeLessThanOrEqual(50);
  });

  it('never throws when the file vanished after the write', () => {
    expect(() =>
      recordChange({ path: path.join(dir, 'gone.txt'), before: 'had content', existed: true, tool: 'write_file' }),
    ).not.toThrow();
  });

  it('list rows carry no file bodies — the summary must stay cheap', () => {
    fs.writeFileSync(file(), 'after');
    recordChange({ path: file(), before: 'before', existed: true, tool: 'edit_file' });
    const row: any = listChanges()[0];
    expect(row.before).toBeUndefined();
    expect(row.after).toBeUndefined();
  });

  it('getChange returns null for an id that has fallen off the list', () => {
    expect(getChange('chg-999')).toBeNull();
  });
});
