/**
 * window-manager.test.ts
 * Tests for src/main/window-manager.ts
 *
 * Uses jest.resetModules() + jest.doMock() per test because `mainWindow` is
 * module-level state that must start null for each test.
 */

let createMainWindow: () => any;
let getMainWindow: () => any;

let MockBrowserWindow: jest.Mock;
let mockWindowInstance: any;

function makeMockWindowInstance() {
  const inst: any = {
    isDestroyed: jest.fn().mockReturnValue(false),
    focus: jest.fn(),
    loadURL: jest.fn(),
    loadFile: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
    show: jest.fn(),
    webContents: {
      session: {
        setPermissionRequestHandler: jest.fn(),
      },
      on: jest.fn(),
      openDevTools: jest.fn(),
    },
  };
  return inst;
}

function loadModule(overrides: { isDev?: boolean; isDevelopment?: boolean; rendererUrl?: string } = {}) {
  jest.resetModules();
  mockWindowInstance = makeMockWindowInstance();
  MockBrowserWindow = jest.fn().mockImplementation(() => mockWindowInstance);

  jest.doMock('electron', () => ({ BrowserWindow: MockBrowserWindow }));
  jest.doMock('@electron-toolkit/utils', () => ({ is: { dev: overrides.isDev ?? false } }));
  jest.doMock('../env', () => ({ isDevelopment: overrides.isDevelopment ?? false }));

  if (overrides.rendererUrl !== undefined) {
    process.env.ELECTRON_RENDERER_URL = overrides.rendererUrl;
  } else {
    delete process.env.ELECTRON_RENDERER_URL;
  }

  const mod = require('../window-manager');
  createMainWindow = mod.createMainWindow;
  getMainWindow = mod.getMainWindow;
}

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.ELECTRON_RENDERER_URL;
});

// --------------------------------
// getMainWindow
// --------------------------------
describe('getMainWindow', () => {
  test('returns null before any window is created', () => {
    loadModule();
    expect(getMainWindow()).toBeNull();
  });

  test('returns the BrowserWindow instance after createMainWindow()', () => {
    loadModule();
    createMainWindow();
    expect(getMainWindow()).toBe(mockWindowInstance);
  });

  test('returns null after the closed event fires', () => {
    loadModule();
    createMainWindow();
    // Trigger the 'closed' handler registered via win.on('closed', ...)
    const closedCall = mockWindowInstance.on.mock.calls.find(([ev]: [string]) => ev === 'closed');
    expect(closedCall).toBeDefined();
    closedCall[1](); // invoke handler
    expect(getMainWindow()).toBeNull();
  });
});

// --------------------------------
// createMainWindow — window creation
// --------------------------------
describe('createMainWindow — window creation', () => {
  test('constructs exactly one BrowserWindow on first call', () => {
    loadModule();
    createMainWindow();
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
  });

  test('returns the window instance', () => {
    loadModule();
    const win = createMainWindow();
    expect(win).toBe(mockWindowInstance);
  });

  test('does NOT create a second window when one already exists', () => {
    loadModule();
    createMainWindow(); // first call
    createMainWindow(); // second call — window already exists and not destroyed
    expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
  });

  test('focuses existing window on second call', () => {
    loadModule();
    createMainWindow();
    createMainWindow();
    expect(mockWindowInstance.focus).toHaveBeenCalledTimes(1);
  });

  test('creates a new window when the existing one is destroyed', () => {
    loadModule();
    createMainWindow(); // first window
    mockWindowInstance.isDestroyed.mockReturnValue(true);
    const newInstance = makeMockWindowInstance();
    MockBrowserWindow.mockImplementationOnce(() => newInstance);
    createMainWindow(); // second window
    expect(MockBrowserWindow).toHaveBeenCalledTimes(2);
  });
});

// --------------------------------
// createMainWindow — loading
// --------------------------------
describe('createMainWindow — page loading', () => {
  test('calls loadFile with a path containing index.html (production mode)', () => {
    loadModule({ isDev: false });
    createMainWindow();
    expect(mockWindowInstance.loadFile).toHaveBeenCalledTimes(1);
    expect(mockWindowInstance.loadFile.mock.calls[0][0]).toContain('index.html');
  });

  test('calls loadURL with ELECTRON_RENDERER_URL in dev mode', () => {
    loadModule({ isDev: true, rendererUrl: 'http://localhost:5173' });
    createMainWindow();
    expect(mockWindowInstance.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(mockWindowInstance.loadFile).not.toHaveBeenCalled();
  });

  test('falls back to loadFile when in dev mode but no ELECTRON_RENDERER_URL', () => {
    loadModule({ isDev: true });
    createMainWindow();
    expect(mockWindowInstance.loadFile).toHaveBeenCalledTimes(1);
    expect(mockWindowInstance.loadURL).not.toHaveBeenCalled();
  });
});

// --------------------------------
// createMainWindow — lifecycle events
// --------------------------------
describe('createMainWindow — lifecycle events', () => {
  test('registers a ready-to-show once listener', () => {
    loadModule();
    createMainWindow();
    const call = mockWindowInstance.once.mock.calls.find(([ev]: [string]) => ev === 'ready-to-show');
    expect(call).toBeDefined();
  });

  test('ready-to-show handler calls show()', () => {
    loadModule();
    createMainWindow();
    const call = mockWindowInstance.once.mock.calls.find(([ev]: [string]) => ev === 'ready-to-show');
    call![1](); // invoke handler
    expect(mockWindowInstance.show).toHaveBeenCalledTimes(1);
  });

  test('registers a closed on listener', () => {
    loadModule();
    createMainWindow();
    const call = mockWindowInstance.on.mock.calls.find(([ev]: [string]) => ev === 'closed');
    expect(call).toBeDefined();
  });

  test('does NOT open DevTools in production mode', () => {
    loadModule({ isDevelopment: false });
    createMainWindow();
    expect(mockWindowInstance.webContents.openDevTools).not.toHaveBeenCalled();
  });

  test('opens DevTools in development mode', () => {
    loadModule({ isDevelopment: true });
    createMainWindow();
    expect(mockWindowInstance.webContents.openDevTools).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------
// createMainWindow — permission handler
// --------------------------------
describe('createMainWindow — permission handler', () => {
  test('registers setPermissionRequestHandler', () => {
    loadModule();
    createMainWindow();
    expect(mockWindowInstance.webContents.session.setPermissionRequestHandler)
      .toHaveBeenCalledTimes(1);
  });

  test.each(['media', 'microphone', 'audioCapture'])(
    'allows %s permission',
    (permission) => {
      loadModule();
      createMainWindow();
      const handler = mockWindowInstance.webContents.session.setPermissionRequestHandler.mock.calls[0][0];
      const cb = jest.fn();
      handler({}, permission, cb);
      expect(cb).toHaveBeenCalledWith(true);
    }
  );

  test.each(['camera', 'geolocation', 'notifications'])(
    'denies %s permission',
    (permission) => {
      loadModule();
      createMainWindow();
      const handler = mockWindowInstance.webContents.session.setPermissionRequestHandler.mock.calls[0][0];
      const cb = jest.fn();
      handler({}, permission, cb);
      expect(cb).toHaveBeenCalledWith(false);
    }
  );
});
