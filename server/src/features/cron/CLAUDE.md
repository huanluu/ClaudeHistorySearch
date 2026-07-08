# Cron Feature

## What

General-purpose scheduled task system. Users create cron jobs via the assistant chat ("schedule a dead code sweep tonight"), and the server executes them on schedule by spawning Copilot CLI sessions.

## Why

The assistant is most valuable when it works proactively — running mechanical tasks while the user sleeps (dead code sweeps, test coverage gaps, codebase investigations). The existing `HeartbeatService` is single-purpose (ADO work item triage). This feature provides a general scheduling engine that the assistant can manage conversationally.

## How It Works

```
User: "schedule a dead code sweep every night"
  → Assistant calls cron_add (Copilot custom tool)
    → CronService.addJob() persists to SQLite
    → Scheduler tick (every 60s) checks for due jobs
      → Spawns Copilot CLI via CliRuntime.runHeadless()
      → Updates job state (lastRunStatus, nextRunAtMs, sessionId)
      → Session output gets indexed by search (existing pipeline)
```

### Architecture

- **CronService** (`CronService.ts`) — effectless business logic. All I/O injected: `CronRepository` for persistence, `runFn` for CLI execution.
- **CronRepository** — port in `shared/provider/types.ts`, implemented by `SqliteCronRepository` in `shared/infra/database/`.
- **MCP tools** — `shared/infra/assistant/cronMcpTools.ts` creates an in-process SDK MCP server with 6 tools (`cron_add`, `cron_list`, `cron_status`, `cron_run`, `cron_update`, `cron_remove`). Imports `CronToolService` port from `shared/provider/`, not the concrete class.
- **REST API** — `routes.ts` exposes `/cron/jobs` endpoints.

### Schedule Types (v1)

- **`at`** — one-shot, ISO timestamp. Auto-disables after execution.
- **`every`** — recurring interval in milliseconds (e.g., `"3600000"` = 1 hour).
- **`cron`** — not yet supported (v2, requires `cron-parser` dependency).

### Safety

- **Concurrency lock** — only one tick runs at a time.
- **Max 3 jobs per tick** — prevents resource exhaustion.
- **Circuit breaker** — auto-disables job after 5 consecutive errors.
- **In-flight tracking** — `stopScheduler()` awaits all running jobs before returning.
- **Process tracking** — the selected `CliRuntime` tracks spawned processes; `app.stop()` cleans them up (REL-INV-2).

## REST API

Full CRUD on `/cron/jobs`. Exists for three reasons:

1. **Debugging and scripting** — `curl` is the fastest way to inspect/test cron state.
2. **Mac app dashboard** — the client reads `GET /cron/jobs` to show a status list. Management (create/update/delete) happens through the assistant chat, not client UI forms.
3. **Future admin UI** — if a web admin panel is ever needed, the endpoints are ready.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cron/jobs` | GET | List all jobs |
| `/cron/jobs/:id` | GET | Get single job |
| `/cron/jobs` | POST | Create job |
| `/cron/jobs/:id` | PUT | Update job |
| `/cron/jobs/:id` | DELETE | Remove job |
| `/cron/jobs/:id/run` | POST | Trigger immediate execution |

## Future (v2)

- **Proactive push** — stream cron results into the assistant chat (#69)
- **Cron expressions** — `"0 2 * * *"` for "every night at 2am"
- **Client dashboard** — read-only list in Mac app with "run now" button
