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

## Feature-First Architecture (ESLint-Enforced)

The server is organized by **feature** (vertical slices) with shared infrastructure:

```
shared/provider → shared/database → shared/runtime
         ↓               ↓               ↓
    features/search, features/live, features/scheduler, features/admin
                              ↓
                           app.ts (composition root)
```

### Shared Modules

| Module | Purpose | Can Import |
|--------|---------|------------|
| `shared/provider/` | Cross-cutting: logger, auth, security | Nothing |
| `shared/database/` | Data access: SQLite, FTS5, repository interfaces + implementations | `shared/provider` |
| `shared/transport/` | HTTP server infrastructure: Express, Transport base class | `shared/provider` |
| `shared/runtime/` | Agent execution: `AgentExecutor` spawns headless `claude -p` processes | `shared/provider` |

### Feature Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `features/search/` | Session indexing, FTS5 search, file watching | `indexer.ts`, `FileWatcher.ts`, `routes.ts` |
| `features/live/` | Interactive agent sessions via WebSocket | `AgentStore.ts`, `WebSocketTransport.ts` |
| `features/scheduler/` | Autonomous agent runs on a schedule (ADO work items) | `HeartbeatService.ts`, `routes.ts` |
| `features/admin/` | Observability, config management, admin UI | `DiagnosticsService.ts`, `ConfigService.ts`, `routes.ts` |

### Root Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, signal handlers, error safety net |
| `app.ts` | Composition root — wires shared + features, only place for cross-module `new` |

**Key rules (enforced by ESLint + scorecard):**
- Features import from `shared/`, never from each other (type-only cross-feature imports allowed)
- All cross-module imports go through `index.ts` barrels
- No circular dependencies
- Each feature exports `registerXxxRoutes(router, deps)` — `app.ts` calls all of them

Violations cause ESLint errors. The scorecard test (`tests/scorecard.test.ts`) also validates at test time.

## Barrel Export Pattern

Every module has an `index.ts` barrel as its public API. **All cross-module imports must go through barrels** (enforced by ESLint):

```typescript
// BEST — type-only import
import type { SessionRepository } from '../../shared/database/index';

// OK — value import from barrel
import { createSessionRepository } from '../../shared/database/index';

// WRONG — bypasses barrel, ESLint error
import { SqliteSessionRepository } from '../../shared/database/SqliteSessionRepository';
```

Barrel files are exempt from this rule since they wire internal imports.

## Code Conventions

- **No `any`**: ESLint forbids `any` in source code. Use precise types or `unknown`
- **No `console`**: Use the structured logger from `shared/provider/`. `console` is ESLint-banned outside logger
- **Constructor injection**: Services receive dependencies explicitly via the composition root (`app.ts`). No global singletons
- **Repository pattern**: Data access behind interfaces (`SessionRepository`, `HeartbeatRepository`) in `shared/database/interfaces.ts`
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

| Endpoint | Method | Feature | Description |
|----------|--------|---------|-------------|
| `/health` | GET | admin | Health check with subsystem status |
| `/diagnostics` | GET | admin | Full system diagnostics snapshot |
| `/admin` | GET | admin | Admin control panel UI |
| `/api/config` | GET | admin | All editable config sections |
| `/api/config/:section` | GET | admin | Single config section |
| `/api/config/:section` | PUT | admin | Update config section (triggers hot-reload) |
| `/sessions` | GET | search | List sessions (pagination via `limit`, `offset`) |
| `/sessions/:id` | GET | search | Get full conversation |
| `/sessions/:id` | DELETE | search | Soft-delete (hide) a session |
| `/sessions/:id/read` | POST | search | Mark session as read |
| `/search?q=term` | GET | search | Full-text search (`sort=relevance\|date`) |
| `/reindex` | POST | search | Trigger reindex (`force=true` to reindex all) |
| `/heartbeat` | POST | scheduler | Manually trigger heartbeat run |
| `/heartbeat/status` | GET | scheduler | Heartbeat config and state |

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
| `src/shared/database/interfaces.ts` | `SessionRepository` and `HeartbeatRepository` contracts |
| `src/shared/runtime/AgentExecutor.ts` | Spawns headless `claude -p` subprocesses |
| `src/features/search/indexer.ts` | JSONL parsing and SQLite FTS5 indexing |
| `src/features/live/WebSocketTransport.ts` | WebSocket protocol, auth, session lifecycle |
| `src/features/scheduler/HeartbeatService.ts` | Autonomous agent runs on a schedule |
| `src/features/admin/DiagnosticsService.ts` | Health checks, system diagnostics |
| `eslint.config.js` | Module boundary + quality rules (flat config format) |
| `tests/__fixtures__/` | Sample JSONL files for testing |
| `tests/scorecard.test.ts` | Structural invariant enforcement |
| `scorecard/SCORECARD.md` | Quality criteria, invariants, metrics, baseline |
