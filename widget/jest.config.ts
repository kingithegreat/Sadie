import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.+(ts|tsx|js)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    // Stub static asset imports (PNG, JPG, SVG, etc.) so Jest doesn't choke on binary files
    '\\.(png|jpg|jpeg|gif|svg|webp|ico)$': '<rootDir>/src/__mocks__/fileMock.ts',
    // Stub CSS/style imports
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/src/renderer/setupTests.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json'
    }
  },
  coverageThreshold: {
    global: {
      branches: 41,
      functions: 53,
      lines: 57,
      statements: 54
    }
  }
};

export default config;
