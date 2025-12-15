module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/*.test.ts',
    '**/*.test.tsx'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Load renderer setup and main-process mocks after the test environment is ready
  setupFiles: [],
  setupFilesAfterEnv: ['<rootDir>/src/main/__tests__/jest-setup.ts', '<rootDir>/src/renderer/setupTests.ts', '<rootDir>/src/main/__tests__/jest-setup-after-env.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json'
    }
  }
};
