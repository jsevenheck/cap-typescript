module.exports = {
  root: true,
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname
  },
  ignorePatterns: ['**/dist/**', '**/types/**', '**/gen/**', '**/*.d.ts'],
  overrides: [
    {
      files: ['srv/**/*.ts', 'tests/**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: ['./srv/tsconfig.json', './tests/tsconfig.json'],
        tsconfigRootDir: __dirname
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'prettier'
      ],
      rules: {
        '@typescript-eslint/no-floating-promises': 'error'
      }
    }
  ]
};
