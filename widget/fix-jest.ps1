Write-Host "🔧 Fixing Jest configuration..." -ForegroundColor Cyan
Write-Host ""

# Navigate to widget directory
Set-Location -Path "C:\Users\adenk\Desktop\sadie\widget"

# Create __tests__ directory if it doesn't exist
if (-not (Test-Path "src\__tests__")) {
    New-Item -ItemType Directory -Path "src\__tests__" -Force | Out-Null
    Write-Host "✓ Created src\__tests__ directory" -ForegroundColor Green
}

# Remove old setup files from wrong locations
Write-Host "🔧 Fixing Jest configuration..." -ForegroundColor Cyan
Write-Host ""

# Navigate to widget directory
Set-Location -Path "C:\Users\adenk\Desktop\sadie\widget"

# Create __tests__ directory if it doesn't exist
if (-not (Test-Path "src\__tests__")) {
    New-Item -ItemType Directory -Path "src\__tests__" -Force | Out-Null
    Write-Host "✓ Created src\__tests__ directory" -ForegroundColor Green
}

# Create jest-setup.ts (runs BEFORE Jest globals)
$setupContent = @"
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

process.env.NODE_ENV = 'test';

const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
process.env.SADIE_TEST_CONFIG_DIR = testConfigDir;

console.log('[JEST SETUP] Test config directory:', testConfigDir);
"@

Set-Content -Path "src\__tests__\jest-setup.ts" -Value $setupContent -Encoding UTF8
Write-Host "✓ Created src\__tests__\jest-setup.ts" -ForegroundColor Green

# Create jest-setup-after-env.ts (runs AFTER Jest globals)
$setupAfterEnvContent = @"
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const mockApp = {
  getPath: jest.fn((name: string) => {
    const tmpDir = process.env.SADIE_TEST_CONFIG_DIR || 
                   fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    return tmpDir;
  }),
  getVersion: jest.fn(() => '1.0.0'),
  getName: jest.fn(() => 'SADIE'),
  isReady: jest.fn(() => true),
  whenReady: jest.fn(() => Promise.resolve()),
  quit: jest.fn(),
  on: jest.fn(),
};

const mockIpcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
};

const mockBrowserWindow = jest.fn().mockImplementation(() => ({
  loadURL: jest.fn(() => Promise.resolve()),
  webContents: { send: jest.fn(), on: jest.fn() },
  on: jest.fn(),
}));

jest.mock('electron', () => ({
  app: mockApp,
  ipcMain: mockIpcMain,
  BrowserWindow: mockBrowserWindow,
  dialog: {
    showMessageBox: jest.fn(() => Promise.resolve({ response: 0 })),
  },
  shell: {
    openExternal: jest.fn(() => Promise.resolve()),
  },
}));

global.window = global.window || {};
(global.window as any).electron = {
  ipcRenderer: {
    invoke: jest.fn(() => Promise.resolve()),
    sendStreamMessage: jest.fn(),
    onStreamChunk: jest.fn(() => jest.fn()),
    onStreamEnd: jest.fn(() => jest.fn()),
    onStreamError: jest.fn(() => jest.fn()),
  },
};

(global.window as any).__e2eEvents = [];

export { mockApp, mockIpcMain, mockBrowserWindow };

afterEach(() => {
  jest.clearAllMocks();
});

console.log('[JEST SETUP AFTER ENV] Electron mocks configured');
"@

Set-Content -Path "src\__tests__\jest-setup-after-env.ts" -Value $setupAfterEnvContent -Encoding UTF8
Write-Host "✓ Created src\__tests__\jest-setup-after-env.ts" -ForegroundColor Green

# Create jest.config.js
$jestConfig = @"
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFiles: [
    '<rootDir>/src/__tests__/jest-setup.ts'
  ],
  setupFilesAfterEnv: [
    '<rootDir>/src/__tests__/jest-setup-after-env.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node'
      }
    }]
  },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testTimeout: 10000,
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  }
};
"@

Set-Content -Path "jest.config.js" -Value $jestConfig -Encoding UTF8
Write-Host "✓ Created jest.config.js" -ForegroundColor Green

Write-Host "";
Write-Host "✅ Jest configuration fixed!" -ForegroundColor Green
Write-Host "";
Write-Host "📋 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Run tests: npm test --prefix widget" -ForegroundColor White
Write-Host "  2. If tests pass, run the app in dev mode: npm run dev --prefix widget" -ForegroundColor White
