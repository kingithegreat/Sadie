import { stageWorkspaceDraftEdits } from '../components/workspace/workspace-draft-edits';
test('all refactor targets are staged in buffers with descending offsets', () => {
  const files = [{ path: 'C:/project/a.ts', content: 'foo + foo', original: 'foo + foo' }, { path: 'C:/project/b.ts', content: 'foo', original: 'foo' }];
  const changed = stageWorkspaceDraftEdits(files, [
    { path: 'C:\\project\\a.ts', expectedContent: 'foo + foo', changes: [{ start: 0, length: 3, text: 'longName' }, { start: 6, length: 3, text: 'longName' }] },
    { path: 'C:/project/b.ts', expectedContent: 'foo', changes: [{ start: 0, length: 3, text: 'longName' }] },
  ]);
  expect(changed.map(f => f.content)).toEqual(['longName + longName', 'longName']);
  expect(changed.map(f => f.original)).toEqual(['foo + foo', 'foo']);
  expect(files.map(f => f.content)).toEqual(['foo + foo', 'foo']);
});
test('one stale target rejects the whole refactor without modifying any draft', () => {
  const files = [{ path: 'a', content: 'foo' }, { path: 'b', content: 'newer foo' }];
  expect(() => stageWorkspaceDraftEdits(files, [{ path: 'a', expectedContent: 'foo', changes: [{ start: 0, length: 3, text: 'bar' }] }, { path: 'b', expectedContent: 'foo', changes: [{ start: 0, length: 3, text: 'bar' }] }])).toThrow(/changed/);
  expect(files).toEqual([{ path: 'a', content: 'foo' }, { path: 'b', content: 'newer foo' }]);
});
test('out of bounds and overlapping edits are rejected', () => {
  const file = [{ path: 'a', content: 'abc' }];
  expect(() => stageWorkspaceDraftEdits(file, [{ path: 'a', expectedContent: 'abc', changes: [{ start: 1, length: 6, text: 'x' }] }])).toThrow(/Invalid/);
  expect(() => stageWorkspaceDraftEdits(file, [{ path: 'a', expectedContent: 'abc', changes: [{ start: 1, length: 2, text: 'x' }, { start: 0, length: 2, text: 'y' }] }])).toThrow(/overlapping/);
});
