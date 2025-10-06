import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  coverageDirectory: '<rootDir>/dist/coverage',
  collectCoverageFrom: ['<rootDir>/**/*.ts', '!<rootDir>/dist/**', '!<rootDir>/test/**'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.json'
    }
  }
};

export default config;
