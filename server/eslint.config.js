import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['*/database/*', '!*/database/index*'],
          allowTypeImports: true,
          message: "Import from './database/index.js' instead. Use SessionRepository interface, not implementation details.",
        }],
      }],
    },
  },
  {
    // The barrel file itself must import from internal modules
    files: ['src/database/index.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
);
