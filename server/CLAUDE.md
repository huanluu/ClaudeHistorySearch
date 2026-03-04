# Server CLAUDE.md

> TypeScript server conventions. See [root CLAUDE.md](../CLAUDE.md) for project-wide engineering principles, workflow, and Git hygiene.

## Development Commands

```bash
npm test               # Run all Vitest tests
npm test -- --testNamePattern="search"   # Run specific test by name
npm run test:watch     # Watch mode
npm run lint           # ESLint with module boundary enforcement
npm run typecheck      # tsc --noEmit
npm run build          # Build with tsup (esbuild-powered)
npm run key:generate   # Generate API key (destructive — invalidates existing key, ask user first)
```

**Do NOT run `npm start` or `npm run dev` as an agent** — they start long-lived processes that die with the Claude Code session. The production server is managed by launchd (see Server Management below). For testing worktree changes, see "Testing Server from a Worktree".

## Layered Architecture (ESLint-Enforced)

Dependency direction flows left-to-right — a module can only import from modules to its left:

```
provider → database → services → sessions/transport → api
```

| Module | Purpose |
|--------|---------|
| `index.ts` | Entry point |
| `app.ts` | Composition root — wires all services together (sole place for `new` across modules) |
| `provider/` | Cross-cutting (logger, auth, security). Cannot import any other module |
| `database/` | Data access (SQLite, FTS5). Can import `provider/` |
| `services/` | Business logic (indexer, FileWatcher, etc.). Can import `provider/`, `database/` |
| `sessions/` and `transport/` | Runtime layer (peers). Can import everything except `api/` |
| `api/` | Top layer (routes). Can import everything |

Data flow: JSONL files → indexer → SQLite FTS5 → REST API

**Invariants (enforced by ESLint + scorecard tests):**
- No file in a lower layer imports from a higher layer
- All cross-module imports go through `index.ts` barrels — never import internal files directly
- No circular dependencies between modules
- Cross-module `new` instantiation only in `app.ts`

Violations cause ESLint errors. The scorecard test (`tests/scorecard.test.ts`) also validates at test time.

## Barrel Export Pattern

Every module has an `index.ts` barrel file as its public API. **All cross-module imports must go through barrels** (enforced by ESLint):

```typescript
// BEST — type-only import (preferred for all cross-module imports)
import type { SessionRepository } from './database/index';

// OK — value import from barrel (only when needed; prefer receiving values via constructor injection)
import { createSessionRepository } from './database/index';

// WRONG — bypasses barrel, ESLint error
import { SqliteSessionRepository } from './database/SqliteSessionRepository';

// EXCEPTION — type-only imports from internals are allowed
import type { SessionRow } from './database/SqliteSessionRepository';
```

**Goal** ([#41](https://github.com/huanluu/ClaudeHistorySearch/issues/41)): Cross-module imports should be type-only. Modules depend on interfaces (types), and concrete values flow through the composition root (`app.ts`). The only exception is `utils/` — a planned layer for stateless pure functions (no dependencies, no side effects) that anyone can value-import. Most service-layer boundaries already follow this; remaining value imports are tracked in [#40](https://github.com/huanluu/ClaudeHistorySearch/issues/40) and [#41](https://github.com/huanluu/ClaudeHistorySearch/issues/41).

Only barrel files (`src/*/index.ts`) are exempt from this rule since they wire internal imports.

## Code Conventions

- **No `any`**: ESLint forbids `any` in source code. Use precise types or `unknown`
- **No `console`**: Use the structured logger from `provider/`. `console` is ESLint-banned outside logger
- **Constructor injection**: Services receive dependencies explicitly via the composition root (`app.ts`). No global singletons
- **Repository pattern**: Data access behind interfaces (`SessionRepository`, `HeartbeatRepository`) in `database/interfaces.ts`
- **TypeScript strictness**: `tsconfig.json` enables all strict checks — `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Code must compile cleanly

## Composition Root

`app.ts` is the sole composition root. All service wiring happens there via constructor injection. Services receive their dependencies explicitly — no singletons, no defaults:

```typescript
const logger = createLogger(LOG_PATH, { errorBuffer });
const db = createDatabase(DB_PATH, logger);
const sessionRepo = createSessionRepository(db);
const heartbeatRepo = createHeartbeatRepository(db);
const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo, logger);
const fileWatcher = new FileWatcher(PROJECTS_DIR, sessionRepo, logger);
```

## Error Handling

- Map SQLite/internal errors at boundaries — don't leak through the API
- The server uses `ErrorRingBuffer(50)` in `DiagnosticsService` to track recent errors in memory
- Structured error logging via `logger.error({ msg, errType, context })`

## Testing

Tests live in `tests/` (not `src/`). Key patterns:

- **Isolation**: Each test creates its own temporary database via `tmpdir()` — no shared state between tests
- **Fixtures**: Sample JSONL files in `tests/__fixtures__/` (standard, array-content, edge-cases, empty, heartbeat) — realistic data, not mocked JSON
- **HTTP tests**: Use `supertest` against the Express app directly (no server binding needed)
- **Scorecard tests**: `tests/scorecard.test.ts` enforces 31 structural invariants (see `scorecard/SCORECARD.md`)

```typescript
// Test naming: descriptive strings in describe/it blocks
describe('SessionRepository', () => {
  it('returns empty array when no sessions match query', async () => {
    // Arrange — setup temp DB
    // Act — call the method
    // Assert — verify outcomes
  });
});
```

### Scorecard System

The quality scorecard (`scorecard/SCORECARD.md`) tracks:
- **Invariants** (Pass/Fail): Automated structural checks — architecture, security, observability
- **Metrics** (Scored 1-5): Subjective quality measures evaluated by reading the code

When adding features, check that scorecard tests still pass. Known failing invariants are tracked with `it.fails()` — when you fix one, promote it to a regular `it()`.

## API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with subsystem status (`healthy` / `degraded`) |
| `/diagnostics` | GET | Full system diagnostics snapshot (503 if unhealthy) |
| `/sessions` | GET | List sessions (pagination via `limit`, `offset`) |
| `/sessions/:id` | GET | Get full conversation |
| `/search?q=term` | GET | Full-text search (`sort=relevance|date`) |
| `/reindex` | POST | Trigger reindex (`force=true` to reindex all) |

### WebSocket Messages (`/ws`)

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| `auth` | Client → Server | Authenticate with API key |
| `auth_result` | Server → Client | Authentication result |
| `session.start` | Client → Server | Start new Claude session |
| `session.resume` | Client → Server | Resume existing session |
| `session.cancel` | Client → Server | Cancel running session |
| `session.output` | Server → Client | Stream session output |
| `session.error` | Server → Client | Session error |
| `session.complete` | Server → Client | Session finished |

## Server Management (launchd)

The server runs as a launchd agent: `com.claude-history-server`

```bash
# Restart the server (single command)
launchctl kickstart -k gui/$(id -u)/com.claude-history-server

# Restart AND reload plist changes
launchctl unload ~/Library/LaunchAgents/com.claude-history-server.plist && launchctl load ~/Library/LaunchAgents/com.claude-history-server.plist

# Check status (PID in first column, - means not running)
launchctl list | grep claude-history-server

# View logs
tail -f /tmp/claude-history-server.log    # stdout
tail -f /tmp/claude-history-server.err    # stderr
```

The plist uses `KeepAlive > SuccessfulExit: false` — auto-restarts on crashes but stays down when stopped intentionally. Do NOT change to `KeepAlive: true`.

**IMPORTANT**: When testing locally, do NOT use a different port. Kill the running server first (`launchctl kickstart -k` or `lsof -ti:3847 | xargs kill`), then start with `npm start`. The iOS/Mac apps and Bonjour discovery are hardcoded to port 3847.

## Testing Server from a Worktree

launchd always runs from main (`/Users/huanlu/Developer/ClaudeHistorySearch/server`). To test worktree changes:

1. Kill the launchd server: `lsof -ti:3847 | xargs kill`
2. Do NOT use `launchctl kickstart/load/unload` — that restarts from main, not the worktree
3. Tell the user to run in a **separate terminal** (outside Claude Code):
   ```
   cd /path/to/worktree/server && npm start
   ```
   Running inside Claude Code inherits `CLAUDECODE` env var, which blocks spawning `claude` subprocesses.
4. After merging to main, restart launchd: `launchctl kickstart -k gui/$(id -u)/com.claude-history-server`

Always verify which server is running: `lsof -ti:3847 | xargs ps -p`

## Key Directories and Files

| Path | Purpose |
|------|---------|
| `src/app.ts` | Composition root — start here to understand wiring |
| `src/database/interfaces.ts` | `SessionRepository` and `HeartbeatRepository` contracts |
| `src/services/indexer.ts` | JSONL parsing and SQLite FTS5 indexing |
| `src/sessions/SessionExecutor.ts` | Spawns headless `claude -p` subprocesses |
| `eslint.config.js` | Module boundary + quality rules (flat config format) |
| `tests/__fixtures__/` | Sample JSONL files for testing |
| `tests/scorecard.test.ts` | Structural invariant enforcement (31 invariants) |
| `scorecard/SCORECARD.md` | Quality criteria, invariants, metrics, baseline |
