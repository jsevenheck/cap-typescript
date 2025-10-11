const path = require('node:path');
const { FlatCompat } = require('@eslint/eslintrc');
const eslintJs = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: eslintJs.configs.recommended,
  allConfig: eslintJs.configs.all,
});

const projectConfigs = [
  path.resolve(__dirname, 'tsconfig.json'),
  path.resolve(__dirname, '../tests/tsconfig.json'),
];

module.exports = [
  {
    ignores: ['**/dist/**', '**/types/**', '**/gen/**', '**/*.d.ts'],
  },
  ...compat.config({
    parser: '@typescript-eslint/parser',
    parserOptions: {
      project: projectConfigs,
      tsconfigRootDir: __dirname,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: ['@typescript-eslint'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:@typescript-eslint/recommended-requiring-type-checking',
      'prettier',
    ],
    env: {
      node: true,
      es2022: true,
    },
    overrides: [
      {
        files: ['test/**/*.ts', 'jest.config.ts'],
        env: {
          jest: true,
          node: true,
        },
      },
    ],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  }),
];
