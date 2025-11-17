export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  roots: ['<rootDir>/src']
};
// Detect open handles in tests; avoid forceExit to rely on proper cleanup instead.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  roots: ['<rootDir>/src'],
  detectOpenHandles: true
};
