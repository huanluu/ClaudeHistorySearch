import tseslint from 'typescript-eslint';

/**
 * Module boundary definitions.
 * Each module exposes a barrel (index.ts) as its public API.
 * Imports that bypass the barrel are flagged by the lint rule below.
 *
 * Module structure:
 *   shared/provider, shared/database, shared/transport, shared/runtime
 *   features/search, features/live, features/scheduler, features/admin
 */
const moduleBoundaries = [
  { name: 'shared/provider',     message: "Import from 'shared/provider/index' instead." },
  { name: 'shared/database',     message: "Import from 'shared/database/index' instead." },
  { name: 'shared/transport',    message: "Import from 'shared/transport/index' instead." },
  { name: 'shared/runtime',      message: "Import from 'shared/runtime/index' instead." },
  { name: 'features/search',     message: "Import from 'features/search/index' instead." },
  { name: 'features/live',       message: "Import from 'features/live/index' instead." },
  { name: 'features/scheduler',  message: "Import from 'features/scheduler/index' instead." },
  { name: 'features/admin',      message: "Import from 'features/admin/index' instead." },
];

/**
 * Generate barrel-enforcement patterns for the given module names.
 * Blocks `*​/name/*` but allows `*​/name/index*` (the barrel).
 */
function barrelPatterns(...names) {
  return names.map(name => {
    const def = moduleBoundaries.find(m => m.name === name);
    return { group: [`*/${name}/*`, `!*/${name}/index*`], allowTypeImports: true, message: def.message };
  });
}

export default tseslint.config(
  // ── Block 1: Global barrel enforcement ──────────────────────────────
  // Every file must go through the barrel; no reaching into module internals.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: moduleBoundaries.map(({ name, message }) => ({
          group: [`*/${name}/*`, `!*/${name}/index*`],
          allowTypeImports: true,
          message,
        })),
      }],
    },
  },

  // ── Block 2: Barrel files — rule OFF (internal wiring) ─────────────
  {
    files: [
      'src/shared/database/index.ts',
      'src/shared/transport/index.ts',
      'src/shared/runtime/index.ts',
      'src/shared/provider/index.ts',
      'src/shared/provider/security/index.ts',
      'src/shared/provider/auth/index.ts',
      'src/shared/provider/logger/index.ts',
      'src/features/search/index.ts',
      'src/features/live/index.ts',
      'src/features/scheduler/index.ts',
      'src/features/admin/index.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  // ── Block 3: shared/provider — cannot import any other module ──────
  {
    files: ['src/shared/provider/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['*/shared/database/*', '*/shared/database'], message: 'shared/provider/ cannot depend on shared/database/.' },
          { group: ['*/shared/transport/*', '*/shared/transport'], message: 'shared/provider/ cannot depend on shared/transport/.' },
          { group: ['*/shared/runtime/*', '*/shared/runtime'], message: 'shared/provider/ cannot depend on shared/runtime/.' },
          { group: ['*/features/*'], message: 'shared/provider/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 4: shared/database — can import shared/provider only ─────
  {
    files: ['src/shared/database/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('shared/provider'),
          { group: ['*/shared/transport/*', '*/shared/transport'], message: 'shared/database/ cannot depend on shared/transport/.' },
          { group: ['*/shared/runtime/*', '*/shared/runtime'], message: 'shared/database/ cannot depend on shared/runtime/.' },
          { group: ['*/features/*'], message: 'shared/database/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 5: shared/transport — can import shared/provider only ────
  {
    files: ['src/shared/transport/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('shared/provider'),
          { group: ['*/shared/database/*', '*/shared/database'], message: 'shared/transport/ cannot depend on shared/database/.' },
          { group: ['*/shared/runtime/*', '*/shared/runtime'], message: 'shared/transport/ cannot depend on shared/runtime/.' },
          { group: ['*/features/*'], message: 'shared/transport/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 6: shared/runtime — can import shared/provider only ──────
  {
    files: ['src/shared/runtime/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('shared/provider'),
          { group: ['*/shared/database/*', '*/shared/database'], message: 'shared/runtime/ cannot depend on shared/database/.' },
          { group: ['*/shared/transport/*', '*/shared/transport'], message: 'shared/runtime/ cannot depend on shared/transport/.' },
          { group: ['*/features/*'], message: 'shared/runtime/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 7: features/* — can import shared/* via barrel. Cross-feature type imports only ──
  {
    files: ['src/features/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('shared/provider', 'shared/database', 'shared/transport', 'shared/runtime'),
          // Cross-feature imports: allowed as type-only
          { group: ['*/features/search/*', '!*/features/search/index*'], allowTypeImports: true, message: "Import from 'features/search/index' instead." },
          { group: ['*/features/live/*', '!*/features/live/index*'], allowTypeImports: true, message: "Import from 'features/live/index' instead." },
          { group: ['*/features/scheduler/*', '!*/features/scheduler/index*'], allowTypeImports: true, message: "Import from 'features/scheduler/index' instead." },
          { group: ['*/features/admin/*', '!*/features/admin/index*'], allowTypeImports: true, message: "Import from 'features/admin/index' instead." },
        ],
      }],
    },
  },

  // ── Block 8: No .js extensions in imports ───────────────────────────
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'ImportDeclaration[source.value=/\\.js$/]',
        message: 'Do not use .js extensions in imports. Use extensionless paths (e.g., ./foo/index).',
      }, {
        selector: 'ExportNamedDeclaration[source.value=/\\.js$/]',
        message: 'Do not use .js extensions in re-exports. Use extensionless paths.',
      }],
    },
  },

  // ── Block 9: Scorecard CQ-INV-1 — no explicit `any` in source ──────
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ── Block 9b: Scorecard TEST-INV-1 — no explicit `any` in tests ────
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Block 10: Scorecard OBS-INV-1 — no console in source ──────────
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/shared/provider/logger/logger.ts',
      'src/shared/provider/auth/keyManager.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
);
