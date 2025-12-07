export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  roots: ['<rootDir>/src'],
  detectOpenHandles: true,
  setupFiles: ['<rootDir>/src/__tests__/setup-tests.ts'],
  testMatch: ['**/__tests__/**/*.test.ts']
};
