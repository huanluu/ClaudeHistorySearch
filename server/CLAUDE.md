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

The server has 4 layers with strict dependency rules:

```
shared/provider     (utility: types, contracts, auth, logging)
       ↓ imported by all layers
       ├── gateway/          (HTTP + WS protocol, client communication)
       ├── shared/infra/     (database, CLI runtime — effectful adapters)
       └── features/*        (business logic, handler registration)
                ↓
             app.ts          (composition root — wires everything)
```

### Dependency Rules (ESLint-enforced)

| From → To | provider | infra | gateway | features | app.ts |
|-----------|:--------:|:-----:|:-------:|:--------:|:------:|
| **provider** | — | NO | NO | NO | — |
| **infra** | YES | — | NO | NO | — |
| **gateway** | YES | NO | — | NO | — |
| **features** | YES | **NEVER** | type-only | type-only cross-feature | — |
| **app.ts** | YES | YES | YES | YES | — |

### Where to Put New Code

| I need to... | Put it in... |
|-------------|-------------|
| Add a new REST endpoint | `features/X/routes.ts` → register with HTTP router |
| Add a new WebSocket message type | `gateway/protocol.ts` (type) + `features/X/handlers.ts` (handler) |
| Add a new CLI runtime (e.g., Copilot CLI) | `shared/infra/runtime/` (implementation) + port interface in consuming feature |
| Add a new database table/query | `shared/provider/types.ts` (interface) + `shared/infra/database/` (implementation) |
| Add a utility function | `shared/provider/` |
| Push a notification to the Mac app | Feature calls `eventBus.broadcast()` (injected from gateway via app.ts) |
| Add a new workflow type | `features/workflows/` (handler + config) |

### Key Contracts

| Contract | File | Between | Defines |
|----------|------|---------|---------|
| Wire protocol | `gateway/protocol.ts` | Server ↔ Client (Mac app) | All message types, payload shapes |
| Gateway interface | `gateway/types.ts` | Gateway ↔ Features | Handler registration, send/broadcast, client lifecycle hooks |
| Domain types | `shared/provider/types.ts` | Features ↔ Infra | SessionRepository, HeartbeatRepository, record types (types only, no values) |
| Feature ports | `features/*/index.ts` | Feature ↔ Infra | Per-feature interfaces (e.g., `AgentExecutorPort` in features/live) |

### Gateway

| File | Purpose |
|------|---------|
| `gateway/protocol.ts` | All wire format message types — single source of truth |
| `gateway/types.ts` | Gateway interface types (`WsHandler`, `WsGateway`, `AuthenticatedClient`) |
| `gateway/HttpTransport.ts` | Express setup, middleware, HTTP route registration |
| `gateway/WebSocketGateway.ts` | WS setup, auth, connections, message routing by type |

### Shared Modules

| Module | Purpose | Can Import |
|--------|---------|------------|
| `shared/provider/` | Utilities + domain type contracts | Nothing (base layer) |
| `shared/provider/types.ts` | Types/interfaces only — SessionRepository, record types | Nothing |
| `shared/infra/database/` | SQLite implementations of repository contracts | `shared/provider` (strict barrel) |
| `shared/infra/runtime/` | CLI runtime adapters (AgentExecutor) | `shared/provider` (strict barrel) |

### Feature Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| `features/search/` | Session indexing, FTS5 search, file watching | `indexer.ts`, `FileWatcher.ts`, `routes.ts` |
| `features/live/` | Interactive agent sessions | `AgentStore.ts`, `handlers.ts` (registers WS handlers) |
| `features/scheduler/` | Autonomous agent runs on a schedule | `HeartbeatService.ts`, `routes.ts` |
| `features/admin/` | Observability, config management | `DiagnosticsService.ts`, `ConfigService.ts`, `routes.ts` |

### Root Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point, signal handlers, error safety net |
| `app.ts` | Composition root — wires gateway + features + infra, only place for cross-module `new` |

### Feature Registration Pattern

Features export registration functions. `app.ts` calls them, passing gateway interfaces and dependencies:

```typescript
// features/search/routes.ts — HTTP handlers
export function registerSearchRoutes(router, deps: SearchDeps) { ... }

// features/live/handlers.ts — WebSocket handlers
export function registerLiveHandlers(gateway: WsGateway, deps: LiveDeps) {
  gateway.on('session.start', (client, payload) => { ... });
  gateway.onDisconnect((client) => { /* cleanup */ });
}
```

Features receive narrow interfaces — never the full gateway or infra internals.

**Key rules (enforced by ESLint + scorecard):**
- Features NEVER import from `shared/infra/` — use interfaces from `shared/provider/` and receive implementations via injection
- Features can only `import type` from `gateway/` — receive gateway dependencies via injection
- All cross-module imports go through `index.ts` barrels
- No circular dependencies
- `shared/provider/types.ts` must only contain types/interfaces (enforced by scorecard test)

Violations cause ESLint errors. The scorecard test (`tests/scorecard.test.ts`) also validates at test time.

## Barrel Export Pattern

Every module has an `index.ts` barrel as its public API. **All cross-module imports must go through barrels** (enforced by ESLint):

```typescript
// BEST — type-only import from provider
import type { SessionRepository } from '../../shared/provider/index';

// OK — value import from infra barrel (only in app.ts)
import { createSessionRepository } from '../../shared/infra/database/index';

// WRONG — bypasses barrel, ESLint error
import { SqliteSessionRepository } from '../../shared/infra/database/SqliteSessionRepository';

// WRONG — features cannot import from shared/infra at all
import type { SessionRepository } from '../../shared/infra/database/index'; // use shared/provider
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
| `src/gateway/protocol.ts` | Wire format: all message types between server and client |
| `src/gateway/WebSocketGateway.ts` | WebSocket auth, connection management, message routing |
| `src/shared/provider/types.ts` | Domain contracts: `SessionRepository`, `HeartbeatRepository`, record types |
| `src/shared/infra/runtime/AgentExecutor.ts` | Spawns headless `claude -p` subprocesses |
| `src/features/search/indexer.ts` | JSONL parsing and SQLite FTS5 indexing |
| `src/features/live/handlers.ts` | WebSocket session handlers (start, resume, cancel) |
| `src/features/live/AgentStore.ts` | Session tracking + `AgentExecutorPort` interface |
| `src/features/scheduler/HeartbeatService.ts` | Autonomous agent runs on a schedule |
| `eslint.config.js` | Module boundary + quality rules (flat config format) |
| `tests/__fixtures__/` | Sample JSONL files for testing |
| `tests/scorecard.test.ts` | Structural invariant enforcement (38 invariants) |
| `scorecard/SCORECARD.md` | Quality criteria, invariants, metrics, baseline |
