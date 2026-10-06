/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import FileTree from '../components/workspace/FileTree';

test('tree rows keep file names and depth separate from nested action controls and support keyboard opening', async () => {
  const source = { path: '/fixture/src', name: 'src', isDirectory: true, size: 0 };
  const file = { path: '/fixture/src/app.ts', name: 'app.ts', isDirectory: false, size: 10 };
  (window as any).electron = { workspaceList: async (directory: string) => ({ success: true, entries: directory === '/fixture' ? [source] : [file] }) };
  const onOpen = jest.fn(), onAction = jest.fn();
  render(<FileTree root="/fixture" activePath={null} onOpenFile={onOpen} onAction={onAction} />);
  const folder = await screen.findByRole('treeitem', { name: 'src', exact: true });
  expect(folder).toHaveAttribute('aria-level', '1');
  fireEvent.keyDown(folder, { key: 'ArrowRight' });
  const row = await screen.findByRole('treeitem', { name: 'app.ts', exact: true });
  expect(folder).toHaveAttribute('aria-expanded', 'true');
  expect(row).toHaveAttribute('aria-level', '2');
  row.focus(); fireEvent.keyDown(row, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledWith(file.path);
  const action = screen.getByRole('combobox', { name: 'Actions for app.ts', exact: true });
  fireEvent.keyDown(action, { key: 'Enter' });
  expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.change(action, { target: { value: 'move' } });
  expect(onAction).toHaveBeenCalledWith('move', file);
});
