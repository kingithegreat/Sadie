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
      moduleNameMapper: {
        '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/src/__mocks__/fileMock.js',
        '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.js'
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
      moduleNameMapper: {
        '\\.(jpg|jpeg|png|gif|svg|webp)$': '<rootDir>/src/__mocks__/fileMock.js',
        '\\.(css|less|scss|sass)$': '<rootDir>/src/__mocks__/styleMock.js'
      },
      setupFilesAfterEnv: [
        '<rootDir>/jest/jest-setup.ts',
        '<rootDir>/jest/jest-setup-after-env.ts'
      ]
    }
  ]
};
