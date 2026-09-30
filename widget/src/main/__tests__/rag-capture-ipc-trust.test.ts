import { readFileSync } from 'fs';
import { join } from 'path';
import { createSourceFile, forEachChild, isCallExpression, isStringLiteral, ScriptTarget, transpileModule } from 'typescript';

// Run the actual two registrations with isolated indexing and capture sinks.
// Booting every integration is unnecessary and could touch the owner's profile.
const source = readFileSync(join(__dirname, '..', 'ipc-handlers.ts'), 'utf8');
const ast = createSourceFile('ipc-handlers.ts', source, ScriptTarget.ES2022, true);
const channels = ['homebot:rag-index', 'homebot:capture-screen'];
const registrations: string[] = [];
function visit(node: any): void {
  if (isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle'
    && isStringLiteral(node.arguments[0]) && channels.includes(node.arguments[0].text)) {
    registrations.push(`${node.getText(ast)};`);
  }
  forEachChild(node, visit);
}
visit(ast);
if (registrations.length !== channels.length) throw new Error('RAG/capture IPC registrations not found');
const code = transpileModule(registrations.join('\n'), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const register = new Function('ipcMain', 'mainWindow', 'getMainWindow', 'ragToolHandlers', 'require', code);

function fixture(options: { window?: 'missing' | 'destroyed'; deferredWindow?: boolean } = {}) {
  const webContents = { mainFrame: {} };
  const window = options.window === 'missing' ? undefined : {
    webContents,
    isDestroyed: () => options.window === 'destroyed',
  };
  const index = jest.fn().mockResolvedValue({ success: true, result: { chunks_indexed: 1 } });
  const capture = jest.fn().mockResolvedValue([{ thumbnail: { toDataURL: () => 'data:image/png;base64,fixture' } }]);
  const handlers: Record<string, Function> = {};
  register({ handle: (channel: string, fn: Function) => { handlers[channel] = fn; } },
    options.deferredWindow ? undefined : window, () => window, { rag_index: index },
    (name: string) => {
      if (name !== 'electron') throw new Error(`Unexpected dependency: ${name}`);
      return { desktopCapturer: { getSources: capture } };
    });
  return { index, capture, handlers, event: { sender: webContents, senderFrame: webContents.mainFrame } };
}

describe.each(channels)('%s explicit UI authority', (channel) => {
  const args = channel === 'homebot:rag-index' ? ['selected-fixture.txt'] : [];

  test.each(['foreign-window', 'child-frame', 'missing-frame'])(
    'denies %s before indexing or screen capture', async (caller) => {
      const f = fixture();
      const event = caller === 'foreign-window' ? { ...f.event, sender: {} }
        : caller === 'child-frame' ? { ...f.event, senderFrame: {} }
        : { sender: f.event.sender };
      expect(await f.handlers[channel](event, ...args)).toMatchObject({ success: false, error: expect.stringMatching(/untrusted/i) });
      expect(f.index).not.toHaveBeenCalled();
      expect(f.capture).not.toHaveBeenCalled();
    });

  test.each(['missing', 'destroyed'] as const)('denies a %s main window without side effects', async (window) => {
    const f = fixture({ window });
    expect(await f.handlers[channel](f.event, ...args)).toMatchObject({ success: false });
    expect(f.index).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });

  test.each([false, true])('accepts the main UI action (deferred window: %s)', async (deferredWindow) => {
    const f = fixture({ deferredWindow });
    expect(await f.handlers[channel](f.event, ...args)).toMatchObject({ success: true });
    if (channel === 'homebot:rag-index') {
      expect(f.index).toHaveBeenCalledWith({ path: 'selected-fixture.txt' }, expect.any(Object));
      expect(f.capture).not.toHaveBeenCalled();
    } else {
      expect(f.capture).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
      expect(f.index).not.toHaveBeenCalled();
    }
  });
});

test('trusted UI web content passes the supplied text to indexing', async () => {
  const f = fixture();
  expect(await f.handlers['homebot:rag-index'](f.event, 'https://example.test/fixture', 'Fixture text'))
    .toMatchObject({ success: true });
  expect(f.index).toHaveBeenCalledWith({ path: 'https://example.test/fixture', web_content: 'Fixture text' }, expect.any(Object));
});

test('invalid trusted UI file input is rejected before indexing', async () => {
  const f = fixture();
  expect(await f.handlers['homebot:rag-index'](f.event, undefined)).toMatchObject({ success: false });
  expect(f.index).not.toHaveBeenCalled();
});
