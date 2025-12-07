import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  coverageDirectory: '<rootDir>/dist/coverage',
  collectCoverage: true,
  collectCoverageFrom: ['<rootDir>/**/*.ts', '!<rootDir>/dist/**', '!<rootDir>/test/**'],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 10,
      functions: 20,
      lines: 20,
      statements: 35,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
};

export default config;
