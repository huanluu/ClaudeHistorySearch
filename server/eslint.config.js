import tseslint from 'typescript-eslint';

/**
 * Module boundary definitions.
 * Each module exposes a barrel (index.ts) as its public API.
 * Imports that bypass the barrel are flagged by the lint rule below.
 *
 * Layer dependency direction (lower can't import higher):
 *   provider → database → services → sessions/transport → api
 */
const moduleBoundaries = [
  { name: 'database',  message: "Import from './database/index.js' instead." },
  { name: 'transport', message: "Import from './transport/index.js' instead." },
  { name: 'sessions',  message: "Import from './sessions/index.js' instead." },
  { name: 'services',  message: "Import from './services/index.js' instead." },
  { name: 'provider',  message: "Import from './provider/index.js' — single entry point for cross-cutting concerns." },
  { name: 'api',       message: "Import from './api/index.js' instead." },
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
      'src/database/index.ts',
      'src/transport/index.ts',
      'src/sessions/index.ts',
      'src/services/index.ts',
      'src/provider/index.ts',
      'src/provider/security/index.ts',
      'src/provider/auth/index.ts',
      'src/api/index.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  // ── Block 3: provider/ — free internally, blocked from ALL business logic ─
  {
    files: ['src/provider/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['*/database/*', '*/database'], message: 'provider/ cannot depend on database/.' },
          { group: ['*/services/*', '*/services'], message: 'provider/ cannot depend on services/.' },
          { group: ['*/sessions/*', '*/sessions'], message: 'provider/ cannot depend on sessions/.' },
          { group: ['*/transport/*', '*/transport'], message: 'provider/ cannot depend on transport/.' },
          { group: ['*/api/*', '*/api'], message: 'provider/ cannot depend on api/.' },
        ],
      }],
    },
  },

  // ── Block 4: database/ — can use provider. Blocked from services+. ─
  {
    files: ['src/database/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('provider'),
          { group: ['*/services/*', '*/services'], message: 'database/ cannot depend on services/.' },
          { group: ['*/sessions/*', '*/sessions'], message: 'database/ cannot depend on sessions/.' },
          { group: ['*/transport/*', '*/transport'], message: 'database/ cannot depend on transport/.' },
          { group: ['*/api/*', '*/api'], message: 'database/ cannot depend on api/.' },
        ],
      }],
    },
  },

  // ── Block 5: services/ — can use provider, database. Blocked from sessions+. ─
  {
    files: ['src/services/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('provider', 'database'),
          { group: ['*/sessions/*', '*/sessions'], message: 'services/ cannot depend on sessions/.' },
          { group: ['*/transport/*', '*/transport'], message: 'services/ cannot depend on transport/.' },
          { group: ['*/api/*', '*/api'], message: 'services/ cannot depend on api/.' },
        ],
      }],
    },
  },

  // ── Block 6: sessions/ — can use provider, database, services. Blocked from transport+. ─
  {
    files: ['src/sessions/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('provider', 'database', 'services'),
          { group: ['*/transport/*', '*/transport'], message: 'sessions/ cannot depend on transport/.' },
          { group: ['*/api/*', '*/api'], message: 'sessions/ cannot depend on api/.' },
        ],
      }],
    },
  },

  // ── Block 7: api/ — can use all barrels (top layer). ───────────────
  {
    files: ['src/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('provider', 'database', 'services', 'sessions', 'transport'),
        ],
      }],
    },
  },

  // transport/ — no dedicated block needed. Global rule (Block 1) handles
  // barrel enforcement, and transport has no upward dependency restrictions
  // since it's a Runtime layer peer with sessions/.
);
