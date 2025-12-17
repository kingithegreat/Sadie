const mockApp = {
  getPath: (_name: string = 'userData') => process.env.TEST_USERDATA || '/tmp/sadie-test',
  getVersion: () => '0.0.0-test',
  isPackaged: false,
  commandLine: {
    appendSwitch: (_name: string, _value?: string) => {},
  },
  whenReady: () => Promise.resolve(),
  relaunch: (_options?: any) => {},
  exit: (_code?: number) => {},
  on: (_event: string, _listener: (...args: any[]) => void) => {},
  once: (_event: string, _listener: (...args: any[]) => void) => {},
  quit: () => {},
  getAppPath: () => process.cwd(),
};

const mockIpcMain: Record<string, any> = {
  handle: (_channel: string, _handler: Function) => {},
  on: (_channel: string, _listener: (...args: any[]) => void) => {},
  removeHandler: (_channel: string) => {},
  emit: (_channel: string, ..._args: any[]) => false,
};

const windows: any[] = [];

function mockBrowserWindow(_options?: any) {
  const webContents = {
    session: {
      setPermissionRequestHandler: (_wc: any, _permission: string, callback: (decision: boolean) => void) => {
        if (typeof callback === 'function') callback(false);
      },
    },
    on: (_event: string, _listener: (...args: any[]) => void) => {},
    openDevTools: (_options?: any) => {},
  };

  const instance = {
    loadFile: async (_path: string) => {},
    once: (_event: string, _listener: (...args: any[]) => void) => {},
    on: (_event: string, _listener: (...args: any[]) => void) => {},
    show: () => {},
    focus: () => {},
    close: () => {},
    isDestroyed: () => false,
    webContents,
  } as any;

  windows.push(instance);
  return instance;
}

(mockBrowserWindow as any).getAllWindows = () => windows;
(mockBrowserWindow as any).resetAll = () => { windows.length = 0; };

export { mockApp, mockIpcMain, mockBrowserWindow };
