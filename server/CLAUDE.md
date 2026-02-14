# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../CLAUDE.md) for project-wide context (API endpoints, launchd management, worktree discipline, etc.).

## Development Commands

```bash
npm start              # Start server locally for testing (kill launchd instance first)
npm run dev            # Start with auto-reload for development (kill launchd instance first)
npm test               # Run all Jest tests (requires --experimental-vm-modules)
npm test -- --testNamePattern="search"   # Run specific test by name
npm run lint           # ESLint with module boundary enforcement
npm run typecheck      # tsc --noEmit
npm run build          # Compile to dist/
npm run key:generate   # Generate API key for authentication
```

## Critical Convention: ESM Imports with .js Extensions

This project uses native ESM (`"type": "module"`). **All relative imports must use `.js` extensions**, even though the source files are `.ts`:

```typescript
// CORRECT
import { logger } from './provider/index.js';
import { createSessionRepository } from '../database/index.js';

// WRONG — will fail at runtime
import { logger } from './provider/index';
import { createSessionRepository } from '../database/index.ts';
```

Jest maps `.js` back to `.ts` via `moduleNameMapper` in `jest.config.js`. TypeScript uses `verbatimModuleSyntax: true` to preserve these extensions in compiled output.

## Layered Architecture (ESLint-Enforced)

Dependency direction flows left-to-right — a module can only import from modules to its left:

```
provider → database → services → sessions/transport → api
```

- `provider/`: Cross-cutting (logger, auth, security). Cannot import any other module.
- `database/`: Data access (SQLite, FTS5). Can import `provider/`.
- `services/`: Business logic (indexer, FileWatcher, etc.). Can import `provider/`, `database/`.
- `sessions/` and `transport/`: Runtime layer (peers). Can import everything except `api/`.
- `api/`: Top layer (routes). Can import everything.

Violations cause ESLint errors. The architecture test (`tests/architecture.test.ts`) also validates this at test time.

## Barrel Export Pattern

Every module has an `index.ts` barrel file as its public API. **All cross-module imports must go through barrels** (enforced by ESLint):

```typescript
// CORRECT — import from barrel
import { createSessionRepository } from './database/index.js';

// WRONG — bypasses barrel, ESLint error
import { SqliteSessionRepository } from './database/SqliteSessionRepository.js';

// EXCEPTION — type-only imports from internals are allowed
import type { SessionRow } from './database/SqliteSessionRepository.js';
```

Only barrel files (`src/*/index.ts`) are exempt from this rule since they wire internal imports.

## Composition Root

`app.ts` is the sole composition root. All service wiring happens there via constructor injection — no global singletons except logger and the database connection. Services receive their dependencies explicitly:

```typescript
const sessionRepo = createSessionRepository();
const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo);
const fileWatcher = new FileWatcher(PROJECTS_DIR, sessionRepo);
```

## Testing

Tests live in `tests/` (not `src/`). Key patterns:

- **Isolation**: Each test creates its own temporary database via `tmpdir()`
- **Fixtures**: Sample JSONL files in `tests/__fixtures__/` (standard, array-content, edge-cases, empty, heartbeat)
- **Architecture tests**: `tests/architecture.test.ts` validates layer boundaries and barrel file existence
- **HTTP tests**: Use `supertest` against the Express app directly (no server binding needed)

Run tests with `node --experimental-vm-modules` (handled by the `npm test` script).

## Key Directories and Files

| Path | Purpose |
|------|---------|
| `src/app.ts` | Composition root — start here to understand wiring |
| `src/database/interfaces.ts` | `SessionRepository` and `HeartbeatRepository` contracts |
| `src/services/indexer.ts` | JSONL parsing and SQLite FTS5 indexing |
| `src/sessions/SessionExecutor.ts` | Spawns headless `claude -p` subprocesses |
| `eslint.config.js` | Module boundary rules (flat config format) |
| `tests/__fixtures__/` | Sample JSONL files for testing |

## TypeScript Strictness

`tsconfig.json` enables all strict checks: `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Code must compile cleanly.
