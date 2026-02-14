import tseslint from 'typescript-eslint';

/**
 * Module boundary definitions.
 * Each module exposes a barrel (index.ts) as its public API.
 * Imports that bypass the barrel are flagged by the lint rule below.
 */
const moduleBoundaries = [
  { name: 'database',  message: "Import from './database/index.js' instead. Use SessionRepository interface, not implementation details." },
  { name: 'transport', message: "Import from './transport/index.js' instead of reaching into internal transport files." },
  { name: 'sessions',  message: "Import from './sessions/index.js' instead of reaching into internal session files." },
  { name: 'services',  message: "Import from './services/index.js' instead of reaching into internal service files." },
  { name: 'auth',      message: "Import from './auth/index.js' instead of reaching into internal auth files." },
];

export default tseslint.config(
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        // For each module, `*/${name}/*` matches imports that cross INTO the folder
        // from outside (e.g. './auth/keyManager.js'), but NOT sibling imports within
        // the folder (e.g. './keyManager.js') since those lack the folder prefix.
        // The `!*/${name}/index*` exception allows the barrel file as the only entry point.
        patterns: moduleBoundaries.map(({ name, message }) => ({
          group: [`*/${name}/*`, `!*/${name}/index*`],
          allowTypeImports: true,
          message,
        })),
      }],
    },
  },
  {
    // Barrel files must import from their own internal modules
    files: [
      'src/database/index.ts',
      'src/transport/index.ts',
      'src/sessions/index.ts',
      'src/services/index.ts',
      'src/auth/index.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
);
