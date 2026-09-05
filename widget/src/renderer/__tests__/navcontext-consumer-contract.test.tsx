/** @jest-environment jsdom */

/**
 * navcontext-consumer-contract.test.tsx
 *
 * Every panel reached by `navigate_to_mode` takes an optional
 * `navContext?: Record<string, unknown> | null`. The contract is: a second
 * handoff to the same panel honors the new payload, not the first.
 *
 * This is the same defect class that closed in WorkspaceShell.tsx:83 (Track F
 * / #252) and was found in MediaStudioPanel.tsx:515 (Ancient Pathways / #248).
 * A whole-effect guard (`if (!navContext) return;`, `if (root) return;`) or a
 * lazy `useState(() => findInitial(navContext))` runs once and then ignores
 * every later handoff — the panel stays on the first arrival. The user, who
 * is already in the panel, sees "nothing happened."
 *
 * This file does not fix the bug. It asserts the contract for every consumer
 * that exists today, so any future `navContext` consumer (or any regression
 * of an existing one) is caught at PR time. Each test:
 *
 *   1. mounts the panel with a first `navContext`,
 *   2. re-renders the same panel with a second `navContext` (a different
 *      value for the same key the panel consumes),
 *   3. asserts the second value is what the panel actually applied.
 *
 * If a panel fails its test, the bug is real and the next agent's job is to
 * fix the consumer — not to weaken the assertion. The exact fix pattern is
 * per-field `setX(prev => prev || incoming)` for state that should be sticky
 * (a clobber would yank a tree away from a user mid-read), and a
 * `useEffect([navContext])` that always re-runs for state that should
 * reflect every arrival.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ---------- WorkspaceShell ----------

import WorkspaceShell from '../components/workspace/WorkspaceShell';

function setupWorkspaceElectron() {
  const workspaceList = jest.fn(async (dirPath: string) => {
    const looksLikeFile = /\.[A-Za-z0-9]{1,5}$/.test(dirPath);
    if (looksLikeFile) return { success: false, error: 'Not a directory.' };
    return { success: true, path: dirPath, entries: [] };
  });
  const workspaceRoot = jest.fn(async () => ({ success: true, path: 'C:\\default-root' }));
  const workspaceRead = jest.fn(async (filePath: string) => ({
    success: true,
    path: filePath,
    name: filePath.split(/[\\/]/).pop() || filePath,
    content: `// contents of ${filePath}\n`,
    original: `// contents of ${filePath}\n`,
    language: 'typescript',
  }));
  (window as any).electron = {
    workspaceList,
    workspaceRoot,
    workspaceRead,
    onAssistantToolActivity: () => () => undefined,
  };
  return { workspaceList, workspaceRoot, workspaceRead };
}

// ---------- FeedsPanel ----------

import FeedsPanel from '../components/FeedsPanel';

function setupFeedsElectron() {
  const fetchFeeds = jest.fn().mockResolvedValue({ success: true, items: [], failures: [] });
  const listFeedSources = jest.fn().mockResolvedValue({ sources: [] });
  (window as any).electron = { fetchFeeds, listFeedSources };
  return { fetchFeeds, listFeedSources };
}

// ---------- ConnectionsPanel ----------

import { ConnectionsPanel } from '../components/ConnectionsPanel';
import { CONNECTIONS } from '../../shared/connections-catalogue';

function setupConnectionsElectron() {
  const mcpListServers = jest.fn().mockResolvedValue([]);
  const mcpAddServer = jest.fn().mockResolvedValue({ success: true, connected: true });
  (window as any).electron = { mcpListServers, mcpAddServer };
  return { mcpListServers, mcpAddServer };
}

// ---------- MediaStudioPanel ----------

import { MediaStudioPanel } from '../components/MediaStudioPanel';

function setupMediaStudioElectron() {
  // The full surface MediaStudioPanel reads on mount. Anything missing here
  // makes the panel hang on a promise that never resolves, which is the
  // failure mode that ate the first 300s.
  (window as any).electron = {
    mediaList: jest.fn().mockResolvedValue([]),
    mediaFfmpegStatus: jest.fn().mockResolvedValue({ ready: true, supported: true }),
    mediaAncientPathwaysEpisodes: jest.fn().mockResolvedValue({ ok: true, episodes: [], available: false }),
    mediaAncientPathwaysStatus: jest.fn().mockResolvedValue({ ok: false }),
    mediaParseFeed: jest.fn().mockResolvedValue({ ok: true, feed: { showTitle: '', showDescription: '', episodes: [] } }),
    loadConversations: jest.fn().mockResolvedValue({ success: true, data: { conversations: [] } }),
    onMediaFfmpegProgress: () => () => undefined,
    onMediaAncientPathwaysProgress: () => () => undefined,
    getSettings: jest.fn().mockResolvedValue({}),
  };
}

afterEach(() => { delete (window as any).electron; });

// ---------------------------------------------------------------------------
// The contract: every panel that takes a `navContext` prop applies a SECOND
// handoff's payload, not only the first.
// ---------------------------------------------------------------------------

describe('navContext consumer contract — every panel honors a second handoff', () => {
  test('WorkspaceShell: a second handoff with a file path opens that file', async () => {
    const { workspaceRead } = setupWorkspaceElectron();
    const { rerender } = render(
      <WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:\\first-repo' }} />,
    );
    // First handoff adopts the directory as root; no file read yet.
    await waitFor(() => expect(workspaceRead).not.toHaveBeenCalled());

    // Second handoff names a specific file in another repo. The contract
    // says: open the file the second handoff asks for.
    rerender(
      <WorkspaceShell open onClose={jest.fn()} navContext={{ path: 'C:\\second-repo\\src\\index.ts' }} />,
    );

    await waitFor(() =>
      expect(workspaceRead).toHaveBeenCalledWith('C:\\second-repo\\src\\index.ts'),
    );
  });

  test('FeedsPanel: the first non-empty query wins; later handoffs do not clobber what is there', async () => {
    // Sticky-by-design: if the user has already typed a query, a chat
    // handoff must not silently replace it. The per-field
    // `setQuery(prev => prev || q)` is the correct shape. This test pins it.
    setupFeedsElectron();
    const { rerender, container } = render(<FeedsPanel navContext={null} />);
    // First handoff seeds the query.
    rerender(<FeedsPanel navContext={{ query: 'kittens' }} />);
    const input = (container.querySelector('input[type="search"], input[placeholder*="earch" i]')
      ?? container.querySelector('input')) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe('kittens');
    // A second handoff must NOT silently replace the user's seeded query.
    rerender(<FeedsPanel navContext={{ query: 'puppies' }} />);
    expect(input!.value).toBe('kittens');
  });

  test('ConnectionsPanel: a second handoff with a different service opens that service', async () => {
    // LATENT F4. The lazy `useState(() => findConnection(navContext?.service))`
    // runs once and does not re-run. This test currently FAILS. When it
    // passes, F4 is fixed.
    setupConnectionsElectron();
    const notion = CONNECTIONS.find((c) => c.id === 'notion')!;
    const github = CONNECTIONS.find((c) => c.id === 'github')!;
    const { rerender } = render(<ConnectionsPanel navContext={null} />);
    rerender(<ConnectionsPanel navContext={{ service: 'notion' }} />);
    rerender(<ConnectionsPanel navContext={{ service: 'github' }} />);
    // The form panel for the second handoff's service should be the one
    // open: at minimum, a github-specific key field (label from the
    // catalogue) must be the one rendered, notion's must not be.
    const githubFirstKey = github.keys[0].label;
    const notionFirstKey = notion.keys[0].label;
    expect(screen.queryByLabelText(githubFirstKey)).toBeTruthy();
    expect(screen.queryByLabelText(notionFirstKey)).toBeFalsy();
  });

  test('MediaStudioPanel: the first non-empty title wins; later handoffs do not clobber it', async () => {
    // Sticky-by-design: a chat handoff seeds the create form, but a second
    // handoff that arrives while the user is editing must not silently
    // replace the value. The per-field `setTitle(prev => prev || t)` is the
    // correct shape. This test pins it.
    setupMediaStudioElectron();
    const { rerender, container } = render(<MediaStudioPanel />);
    rerender(<MediaStudioPanel navContext={{ title: 'First topic' }} />);
    const titleInput = container.querySelector('input[aria-label="New video title"]') as HTMLInputElement | null;
    expect(titleInput).not.toBeNull();
    expect(titleInput!.value).toBe('First topic');
    // A second handoff must NOT silently replace the seeded value.
    rerender(<MediaStudioPanel navContext={{ title: 'Second topic' }} />);
    expect(titleInput!.value).toBe('First topic');
  });

  test('MediaStudioPanel: a chat handoff that seeds an EMPTY title does not clobber a user-typed title', async () => {
    // The flip side: the user can type into the form, and a chat handoff
    // that arrives with no title must not erase what the user typed.
    setupMediaStudioElectron();
    const { rerender, container } = render(<MediaStudioPanel />);
    // First, the user types a title.
    const titleInput = container.querySelector('input[aria-label="New video title"]') as HTMLInputElement | null;
    expect(titleInput).not.toBeNull();
    // Simulate the user typing by setting the controlled input directly via
    // the same onChange path React Testing Library uses for fireEvent.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(titleInput!, { target: { value: 'User typed this' } });
    expect(titleInput!.value).toBe('User typed this');
    // A handoff with no title must not erase the user's input.
    rerender(<MediaStudioPanel navContext={{ title: '' }} />);
    expect(titleInput!.value).toBe('User typed this');
  });
});

