// __mocks__/electron.js
module.exports = {
  app: {
    isPackaged: false,
    getPath: jest.fn().mockReturnValue('/tmp/homebot-test-path'), // Mock valid path
    getAppPath: jest.fn().mockReturnValue('/tmp/homebot-app-path'),
  },
  ipcRenderer: {
    on: jest.fn(),
    send: jest.fn(),
    invoke: jest.fn(),
  },
  // Mock other electron modules as needed
};