import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.+(ts|tsx|js)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: [
    '<rootDir>/src/renderer/setupTests.ts',
    '<rootDir>/src/main/__tests__/jest-setup-after-env.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main/__tests__/jest-setup.ts',
    '<rootDir>/src/main/__tests__/jest-setup-after-env.ts',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json'
    }
  }
};

export default config;
