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
  { name: 'database',  message: "Import from './database/index' instead." },
  { name: 'transport', message: "Import from './transport/index' instead." },
  { name: 'sessions',  message: "Import from './sessions/index' instead." },
  { name: 'services',  message: "Import from './services/index' instead." },
  { name: 'provider',  message: "Import from './provider/index' — single entry point for cross-cutting concerns." },
  { name: 'api',       message: "Import from './api/index' instead." },
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
  // Scorecard ARCH-INV-1: Layer Import Direction (Blocks 3–7 enforce this)
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

  // ── Block 8: No .js extensions in imports ───────────────────────────
  // After migrating to Vitest + tsup with moduleResolution "Bundler",
  // .js extensions are unnecessary and confusing.
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
  // Scorecard CQ-INV-1: Zero `any` Types in Source Code
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ── Block 9: Scorecard TEST-INV-1 — no explicit `any` in tests ────
  // Scorecard TEST-INV-1: No Type Escape Hatches in Tests
  // Using 'warn' because 3 known violations exist (tracked by scorecard test).
  // Upgrade to 'error' after fixing: config.test.ts:84, config-security.test.ts:40,47
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Block 10: Scorecard OBS-INV-1 — no console in source ──────────
  // Scorecard OBS-INV-1: No Console in Source Code
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/provider/logger/logger.ts',   // Logger wraps console behind opt-in flag
      'src/provider/auth/keyManager.ts',  // CLI entry point (guarded by process.argv)
    ],
    rules: {
      'no-console': 'error',
    },
  },
);
