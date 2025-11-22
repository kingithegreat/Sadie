module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/__tests__/setup-tests.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
};
