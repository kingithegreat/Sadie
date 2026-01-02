module.exports = {
  projects: [
    {
      displayName: 'main',
      testMatch: ['<rootDir>/src/main/**/*.test.ts'],
      preset: 'ts-jest',
      testEnvironment: 'node',
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { isolatedModules: true }],
      },
      setupFilesAfterEnv: [
        '<rootDir>/jest/jest-setup.ts'
      ],
    },

    {
      displayName: 'renderer',
      testMatch: ['<rootDir>/src/renderer/**/*.test.ts?(x)'],
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { isolatedModules: true }],
      },
      setupFilesAfterEnv: [
        '<rootDir>/jest/jest-setup.ts',
        '<rootDir>/jest/jest-setup-after-env.ts'
      ]
    }
  ]
};
