import tseslint from 'typescript-eslint';

/**
 * Module boundary definitions.
 * Each module exposes a barrel (index.ts) as its public API.
 *
 * Architecture (ports-and-adapters):
 *   shared/provider          (effectless: cross-cutting ports — types, contracts, auth, logging)
 *   shared/infra/<technology> (effectful: adapters organized by technology — database, runtime, parsers)
 *   gateway                  (effectful: HTTP + WebSocket protocol, client communication)
 *   features/*               (effectless: business logic, feature-only ports)
 *
 * NOTE: All group patterns use '**' prefix to match relative paths like '../../shared/infra/...'
 * because single '*' in minimatch does not match across '/' separators.
 */
const moduleBoundaries = [
  { name: 'shared/provider',       message: "Import from 'shared/provider/index' instead." },
  { name: 'shared/infra/database', message: "Import from 'shared/infra/database/index' instead." },
  { name: 'shared/infra/runtime',  message: "Import from 'shared/infra/runtime/index' instead." },
  { name: 'shared/infra/parsers',  message: "Import from 'shared/infra/parsers/index' instead." },
  { name: 'gateway',               message: "Import from 'gateway/index' instead." },
  { name: 'features/search',       message: "Import from 'features/search/index' instead." },
  { name: 'features/live',         message: "Import from 'features/live/index' instead." },
  { name: 'features/scheduler',    message: "Import from 'features/scheduler/index' instead." },
  { name: 'features/admin',        message: "Import from 'features/admin/index' instead." },
];

/**
 * Generate barrel-enforcement patterns for the given module names.
 * Blocks deep imports into module internals; only the barrel (index) is allowed.
 * Type imports are allowed to bypass the barrel (for features importing types).
 */
function barrelPatterns(...names) {
  return names.map(name => {
    const def = moduleBoundaries.find(m => m.name === name);
    return { group: [`**/${name}/*`, `!**/${name}/index*`], allowTypeImports: true, message: def.message };
  });
}

/**
 * Strict barrel-enforcement — blocks ALL imports (including type-only) that bypass the barrel.
 * Used for infra modules that must always go through the barrel, even for types.
 */
function strictBarrelPatterns(...names) {
  return names.map(name => {
    const def = moduleBoundaries.find(m => m.name === name);
    return { group: [`**/${name}/*`, `!**/${name}/index*`], message: def.message };
  });
}

export default tseslint.config(
  // ── Block 1: Global barrel enforcement ──────────────────────────────
  // Every file must go through the barrel; no reaching into module internals.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scorecard/tests/**/*.ts'],
    extends: [tseslint.configs.base],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: moduleBoundaries.map(({ name, message }) => ({
          group: [`**/${name}/*`, `!**/${name}/index*`],
          allowTypeImports: true,
          message,
        })),
      }],
    },
  },

  // ── Block 2: Barrel files — rule OFF (internal wiring) ─────────────
  {
    files: [
      'src/shared/infra/database/index.ts',
      'src/shared/infra/runtime/index.ts',
      'src/shared/infra/parsers/index.ts',
      'src/shared/provider/index.ts',
      'src/shared/provider/security/index.ts',
      'src/shared/provider/auth/index.ts',
      'src/shared/provider/logger/index.ts',
      'src/gateway/index.ts',
      'src/features/search/index.ts',
      'src/features/live/index.ts',
      'src/features/scheduler/index.ts',
      'src/features/admin/index.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  // ── Block 3: shared/provider — base layer, imports nothing ──────────
  {
    files: ['src/shared/provider/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/shared/infra/**', '**/shared/infra'], message: 'shared/provider/ cannot depend on shared/infra/.' },
          { group: ['**/gateway/**', '**/gateway'], message: 'shared/provider/ cannot depend on gateway/.' },
          { group: ['**/features/**'], message: 'shared/provider/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 4: shared/infra/database — imports shared/provider only, no sibling infra ──
  {
    files: ['src/shared/infra/database/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...strictBarrelPatterns('shared/provider'),
          { group: ['**/shared/infra/runtime/**', '**/shared/infra/runtime'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/shared/infra/parsers/**', '**/shared/infra/parsers'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/gateway/**', '**/gateway'], message: 'shared/infra/ cannot depend on gateway/.' },
          { group: ['**/features/**'], message: 'shared/infra/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 5: shared/infra/runtime — imports shared/provider only, no sibling infra ──
  {
    files: ['src/shared/infra/runtime/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...strictBarrelPatterns('shared/provider'),
          { group: ['**/shared/infra/database/**', '**/shared/infra/database'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/shared/infra/parsers/**', '**/shared/infra/parsers'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/gateway/**', '**/gateway'], message: 'shared/infra/ cannot depend on gateway/.' },
          { group: ['**/features/**'], message: 'shared/infra/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 5b: shared/infra/parsers — imports shared/provider only, no sibling infra ──
  {
    files: ['src/shared/infra/parsers/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...strictBarrelPatterns('shared/provider'),
          { group: ['**/shared/infra/database/**', '**/shared/infra/database'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/shared/infra/runtime/**', '**/shared/infra/runtime'], message: 'Infra modules cannot depend on sibling infra modules.' },
          { group: ['**/gateway/**', '**/gateway'], message: 'shared/infra/ cannot depend on gateway/.' },
          { group: ['**/features/**'], message: 'shared/infra/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 6: gateway — imports shared/provider only ─────────────────
  {
    files: ['src/gateway/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          ...barrelPatterns('shared/provider'),
          { group: ['**/shared/infra/**', '**/shared/infra'], message: 'gateway/ cannot depend on shared/infra/.' },
          { group: ['**/features/**'], message: 'gateway/ cannot depend on features/.' },
        ],
      }],
    },
  },

  // ── Block 7: features — shared/provider (any) + gateway (type-only) ──
  {
    files: ['src/features/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          // Barrel enforcement for shared/provider
          ...barrelPatterns('shared/provider'),
          // Block ALL imports from shared/infra (types and values)
          { group: ['**/shared/infra/**', '**/shared/infra'], message: 'Features cannot import from shared/infra/. Use interfaces from shared/provider and receive implementations via injection.' },
          // Block value imports from gateway (type-only allowed)
          { group: ['**/gateway/**', '**/gateway'], allowTypeImports: true, message: "Features can only use 'import type' from gateway/. Receive gateway dependencies via injection." },
          // Cross-feature: type-only via barrel
          { group: ['**/features/search/*', '!**/features/search/index*'], allowTypeImports: true, message: "Import from 'features/search/index' instead." },
          { group: ['**/features/live/*', '!**/features/live/index*'], allowTypeImports: true, message: "Import from 'features/live/index' instead." },
          { group: ['**/features/scheduler/*', '!**/features/scheduler/index*'], allowTypeImports: true, message: "Import from 'features/scheduler/index' instead." },
          { group: ['**/features/admin/*', '!**/features/admin/index*'], allowTypeImports: true, message: "Import from 'features/admin/index' instead." },
        ],
      }],
    },
  },

  // ── Block 7b: Test files — relaxed architecture rules ────────────────
  // Test files (co-located and scorecard) may import freely across modules.
  {
    files: ['src/**/*.test.ts', 'scorecard/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  // ── Block 7c: ARCH-INV-9 — Features must be effectless (no I/O imports) ──
  // Features define ports for effects; adapters in shared/infra/ implement them.
  // TODO: Promote to 'error' once existing violations are migrated to shared/infra/
  {
    files: ['src/features/**/*.ts'],
    ignores: ['src/features/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['warn',
        { name: 'fs', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'fs/promises', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'child_process', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'net', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'http', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'https', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'better-sqlite3', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:fs', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:fs/promises', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:child_process', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:net', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:http', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
        { name: 'node:https', message: 'Features must be effectless. Define a port interface and implement in shared/infra/<technology>/.' },
      ],
    },
  },

  // ── Block 8: No .js extensions in imports ───────────────────────────
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scorecard/tests/**/*.ts'],
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

  // ── Block 9: No explicit `any` in source ────────────────────────────
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ── Block 9b: CQ-INV-1 — no explicit `any` in tests (error) ────────
  {
    files: ['tests/**/*.ts', 'src/**/*.test.ts', 'scorecard/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // ── Block 10: No console in source ──────────────────────────────────
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.test.ts',
      'src/shared/provider/logger/logger.ts',
      'src/shared/provider/auth/keyManager.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
);
