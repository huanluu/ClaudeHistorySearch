# Proposed Scorecard Additions

> Output of a 15-agent Opus 4.6 evaluation across 4 rounds (2026-03-11).
> These are **proposals**, not decisions. Review, trim, and prioritize before implementing.
>
> Current scorecard: 19/19 passing. These additions would bring it to 19 + N new invariants.

---

## Error Modeling Direction

Before implementing error-related invariants, adopt the three-tier error model
(see `work_md_files/error-handling-guide.md`):

```
Optional   -> absence is normal           -> T | undefined
Result     -> expected business failure    -> Result<T, DomainError>
throw      -> unexpected system failure    -> InfraError / InvariantError
```

Key implementation:

```typescript
// shared/provider/errors.ts

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

type DomainError =
  | { kind: 'not_found'; entity: string; id: string }
  | { kind: 'validation'; field: string; reason: string }
  | { kind: 'conflict'; message: string };

class InfraError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); }
}

class InvariantError extends Error {
  constructor(message: string) { super(`Invariant violation: ${message}`); }
}
```

Features return `Result<T, DomainError>` for expected failures. Only `InvariantError`
throws in feature code. Infra adapters throw `InfraError` with `{ cause }`. Boundary
(routes) maps `DomainError.kind -> HTTP status` and catches unexpected throws as 500.

---

## High/Critical Impact Proposals (22 invariants)

These are the top-priority additions filtered from 62 total proposals across all rounds.

### Legend

- **Pass?**: Would the invariant pass today? PASS = electric fence (prevents regression). FAIL = hill to climb.
- **Enforcement**: How to check. "Deterministic" = structural test or ESLint. "LLM-scored" = agent team evaluation.
- **Flakiness**: None / Low / Moderate. How likely the check produces false positives/negatives.
- **Section**: Which principle in `docs/invariants.md` (S1-S17) this maps to.

### Critical (2)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 1 | **AF-INV-2** | Scorecard `modules` array in `architecture.test.ts` includes all actual `features/*/` and `shared/infra/*/` directories | FAIL | Glob dirs -> compare to hardcoded array | None | S16 |
| 2 | **SEC-INV-7** | Every registered WS handler type has a Zod payload schema in `payloadSchemas` | PASS | Scan `gateway.on(` calls -> cross-ref schema keys. Exempt: `ping`, outbound-only types | Low | S1 |

**AF-INV-2 detail**: The scorecard's own `modules` array is missing `features/assistant`, `features/cron`, `shared/infra/parsers`, `shared/infra/assistant`, `shared/infra/filesystem`. ARCH-INV-2 (barrel existence), ARCH-INV-4 (composition root monopoly) don't cover these modules.

### High - Deterministic, Zero Flakiness (5)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 3 | **OBS-INV-3** | `serializeError()` in logger preserves stack traces (not just `.message`) | FAIL | Unit test on `serializeError(new Error('x'))` includes `.stack` | None | S12 |
| 4 | **CQ-INV-12** | `string` fields in `types.ts` with comment-listed allowed values use TypeScript union types instead | FAIL | Regex: `types.ts` for `: string` with `// 'x' \| 'y'` comment pattern. 4 fields: `schedule_kind`, `last_run_status`, `source`, `role` | None | S4 |
| 5 | **TS-INV-3** | No `as unknown as` double-cast in source files (non-test) | FAIL | Grep `src/**/*.ts` (non-test) for `as unknown as`. 4 instances | None | S7 |
| 6 | **AF-INV-1** | ESLint `moduleBoundaries` config covers all `features/*/` and `shared/infra/*/` directories | PASS | Glob dirs -> compare to ESLint config array | None | S16 |
| 7 | **ERR-INV-1** | `index.ts` registers both `unhandledRejection` and `uncaughtException` handlers | PASS | String match in `index.ts` for both `process.on(` patterns | None | S8, S12 |

### High - Deterministic, Low Flakiness (9)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 8 | **ARCH-INV-12** | No barrel re-exports of `shared/provider/` types from infra or feature barrel files | FAIL | Scan `index.ts` barrels for `export.*from.*provider`. 3 files violate | Low | S13, S10 |
| 9 | **ERR-INV-2** | No `.includes()` on `error.message` to determine HTTP status codes in route handlers | FAIL | Scan `routes.ts` catch blocks for `.includes(` preceding `res.status(`. 1 file: `cron/routes.ts` | Low | S14, S4 |
| 10 | **ERR-INV-7** | Feature code must not `throw new Error(` -- expected failures return `Result`, only `InvariantError` throws allowed | FAIL | Regex: `throw new Error(` in `features/**/*.ts` -> target zero. 10+ sites in CronService, 1 in HeartbeatService | Low | S14 |
| 11 | **LSP-INV-1** | `CliRuntime` interface includes `cleanup()` method; `stopApp()` uses it generically instead of referencing concrete `ClaudeRuntime` | FAIL | (a) Check `CliRuntime` in types.ts for `cleanup`; (b) grep `stopApp` for concrete runtime class names. Real bug: CopilotRuntime spawns untracked processes | Low | S8, S9 |
| 12 | **LSP-INV-2** | Test files don't use `as unknown as <PortType>` to bypass interface contracts | FAIL | Count `as unknown as` followed by known port type names in `*.test.ts`. 40+ instances. Use as ratchet (count must decrease) | Low | S7 |
| 13 | **REL-INV-5** | `setInterval`/`setTimeout` with async callbacks have `try/catch` error handling | FAIL | Scan for `setInterval(async` or `setTimeout(async` without `try` in callback body (10-15 line window). 2 instances | Low | S8, S14 |
| 14 | **ERR-INV-3** | All route handler callbacks have try/catch error boundaries | PASS | Scan `router.get/post/put/delete(` callbacks for `try` keyword | Low | S14, S1 |
| 15 | **API-INV-2** | All parameterized HTTP endpoints have Zod validation middleware | FAIL | Cross-ref route paths in `wireHttpRoutes` with validation middleware registrations. Only 3/14 endpoints currently validated | Low | S1 |
| 16 | **OBS-INV-6** | Health endpoint checks all active subsystems (DB, file watcher, WS, heartbeat, cron), not just database | FAIL | Verify `HealthResult.checks` has keys for all subsystems | Low | S12 |

### High - Deterministic, Moderate Flakiness (2)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 17 | **TS-INV-1** | No `as` type assertions in feature code (except `as Error` in catch blocks and `as const`) | FAIL | Regex: `features/**/*.ts` for `\bas\s+[A-Z]`, exclude `as Error` and `as const`. ~10 instances. May false-positive on `as` in string literals | Moderate | S7 |
| 18 | **ERR-INV-4** | Infra adapters don't leak technology-specific errors to features (no `error.code === 'SQLITE_BUSY'` etc. in feature code) | FAIL | Scan `features/**/*.ts` catch blocks for tech-specific error properties. Relies on blocklist of tech properties | Moderate | S14, S10 |

### High - Deterministic, Moderate Flakiness + Needs Exemption Pattern (2)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 19 | **NULL-INV-1** | Feature function parameters don't accept `T \| undefined` or `T \| null` (resolve at boundary) | FAIL | Regex scan `features/**/*.ts` exported function params for `\| undefined`, `\| null`, `?:`. ~5 violations. Needs exemption for `Partial<T>` patterns | Moderate | S3 |
| 20 | **ARCH-INV-13** | Feature function signatures don't reference wire types from `gateway/protocol.ts` (params or returns) | PASS | Scan `features/**/*.ts` for imports from `gateway/protocol` appearing in signatures | Low | S2 |

### High - LLM-Evaluated (2)

| # | ID | What it checks | Pass? | Enforcement | Flakiness | Section |
|---|-----|---------------|:-----:|-------------|:---------:|:-------:|
| 21 | **AF-INV-5** | Every `features/*/` directory has CLAUDE.md explaining purpose, key files, and integration points | FAIL | LLM-scored (1-5): 1pt exists, 1pt explains purpose, 1pt lists key files, 1pt explains integration, 1pt accurate. Threshold: avg >= 3 across 3 agents. 5 of 6 features missing | Moderate | S16 |
| 22 | **OBS-INV-7** | Key operations (`indexAllSessions`, `runHeartbeat`, `executeJob`) log `durationMs` in completion entry | FAIL | LLM-scored or targeted grep for `durationMs` in log calls with matching `op` values | Moderate | S12 |

---

## Medium Impact Proposals (for future batches)

These are worth implementing after the High/Critical batch is done.

### Architecture

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| ARCH-INV-11 | No constructor over 5 parameters | FAIL (HeartbeatService: 7) | Regex + comma count on `constructor(` lines | S6, S9 |
| SRP-INV-1 | Service classes don't mix business logic with lifecycle scheduling | FAIL (HeartbeatService, CronService) | Scan feature classes for timer calls + non-lifecycle public methods | S11 |
| SRP-INV-2 | Route files contain only HTTP wiring, no domain transforms/dedup | FAIL (search/routes.ts, cron/routes.ts) | Scan routes.ts for regex ops on domain data, `new Set()`, helpers not touching req/res | S1, S5 |
| SRP-INV-3 | No class over 10 public methods | FAIL (HeartbeatService: 13, CronService: 11) | Count public methods per class | S9 |
| ISP-INV-1 | No interface in `types.ts` over 8 methods | FAIL (SessionRepository: 11) | Count methods per interface | S5, S9 |
| DIP-INV-1 | Cross-feature type imports reference interfaces, not classes | FAIL (FileWatcher, HeartbeatService in DiagnosticsService) | Scan cross-feature `import type` -> resolve to interface vs class | S5, S13 |

### Code Quality

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| CQ-INV-8 | Every non-barrel export is imported by at least one other file | FAIL (~15 dead symbols) | Grep cross-reference per exported symbol | S16 |
| CQ-INV-9 | Every barrel re-export has at least one external consumer | FAIL (~30 dead lines) | Grep per re-exported symbol outside module | S13, S16 |
| CQ-INV-10 | Max nesting depth of 4 in functions | PASS (borderline) | Brace-depth counter similar to CQ-INV-5 | S16 |
| CQ-INV-11 | Named constants for numeric thresholds (no magic numbers > 1 in function bodies) | FAIL | Scan function bodies for bare numeric literals | S16 |
| CQ-INV-13 | No near-duplicate functions (5+ matching lines) | FAIL (ClaudeAgentSession/CopilotAgentSession) | LLM-scored | S16 |
| TEST-INV-1 | No test file over 500 lines | FAIL (HeartbeatService.test.ts: 1231 lines) | Line count on `*.test.ts` | S16 |
| TEST-INV-2 | No real `setTimeout` sleeps in unit tests | FAIL (5 instances in handlers.test.ts) | Scan `*.test.ts` for `new Promise.*setTimeout` | S8, S16 |

### Error Handling

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| ERR-INV-5 | Catch-and-rethrow preserves cause chain (`{ cause }`) | FAIL (2 sites) | Scan `throw new Error(` inside catch blocks without `{ cause` | S14, S12 |
| ERR-INV-6 | WS error messages include machine-readable `errorCode` from defined enum | FAIL | Scan `client.send` with `type: '*error'` for `errorCode` property | S14, S4 |

### Reliability

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| REL-INV-3 | SQLite connection sets `busy_timeout` pragma | FAIL | String match `busy_timeout` in `connection.ts` | S8 |
| REL-INV-4 | Signal handlers guard against double-shutdown (reentrancy guard) | FAIL | String match for guard variable in `index.ts` signal handler | S4, S8 |
| REL-INV-6 | `stopApp()` cleans up all resources (DB handle, assistant backend, agent sessions) | FAIL | Verify stopApp references all AppContext cleanup methods | S8, S11 |
| REL-INV-7 | Unbounded Maps/Sets have eviction or lifecycle cleanup | FAIL (2 maps) | Scan `new Map()`/`new Set()` for corresponding `delete`/`clear` | S8, S11 |
| CONC-INV-1 | Reindex operations have reentrancy guard (no concurrent reindex) | FAIL | Scan for indexAllSessions callers without `isRunning` guard | S8 |

### Nullability

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| NULL-INV-2 | Route deps interfaces have no optional service fields (`?:` on service types) | FAIL (3 interfaces) | Scan `*Deps` interfaces for `?:` on service types | S3, S6 |
| NULL-INV-3 | No non-null assertions (`!`) in feature code | FAIL (2 sites) | Grep `features/**/*.ts` for `!.` and `![;,)]` | S3, S7 |

### Security

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| SEC-INV-6 | No `eval()`, `new Function()`, or dynamic `require()` in source | PASS | Regex scan all src files | S7 |

### Observability

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| OBS-INV-2 | `logger.log()` not used for rejected/failed/invalid events (use `warn`) | FAIL (5 violations) | Scan `logger.log({` calls whose `msg` contains degradation keywords | S12 |
| OBS-INV-4 | All log calls include `op` field | PASS | Scan `logger.*({` calls for `op:` property | S12 |
| OBS-INV-5 | All `logger.error()` calls include `errType` | FAIL (14/25) | Scan `logger.error({` for `errType:` property | S12 |
| OBS-INV-8 | Session log entries include `sessionId` in context | FAIL | Scan session-handling log calls for `sessionId` in `context` | S12 |
| OBS-INV-9 | Diagnostics includes all subsystem state (cron missing) | FAIL | Verify `DiagnosticsResult` has `cron` field | S12 |

### API Design & Agent-friendliness

| ID | What | Pass? | Enforcement | Section |
|----|------|:-----:|-------------|:-------:|
| OCP-INV-1 | Indexer doesn't check source identity by name (extensible) | PASS | Grep `features/search/` for `'claude'`/`'copilot'` literals | S9 |
| AF-INV-3 | Every feature's `register*` function is called in `app.ts` | PASS | Grep `export function register` in features -> verify call in app.ts | S16 |
| AF-INV-4 | Every ConfigService section has a handler in `onConfigChanged` | PASS | Cross-ref `EDITABLE_SECTIONS` keys with `onConfigChanged` body | S6 |
| API-INV-1 | Consistent REST response envelope shape | FAIL | LLM-scored | S1 |
| CFG-INV-1 | Config defaults defined in one place per domain | FAIL | LLM-scored | S6 |
| DH-INV-1 | Zero known vulnerabilities in production deps | PASS* | `npm audit --omit=dev --json` | S16 |
| DH-INV-2 | Production dependency count cap (<=12) | PASS | Count keys in package.json `dependencies` | S16 |

---

## Dependency Chain: Error Modeling Stack

These invariants should be fixed in order -- each enables the next:

```
ERR-INV-7  (features return Result, not throw Error)
    |
    +-> ERR-INV-2  (route catch blocks are simple: catches = 500 only)
    |
    +-> ERR-INV-4  (infra wraps tech errors in InfraError with { cause })
    |
    +-> ERR-INV-6  (WS errors derive errorCode from DomainError.kind)
    |
    +-> ERR-INV-5  (all rethrows preserve cause chain)
```

---

## Recommended Implementation Order

### Batch 0: Fix the scorecard itself
- **AF-INV-2**: Update `modules` array to include all actual directories

### Batch 1: One-liner fixes, high value
- **OBS-INV-3**: Fix `serializeError()` to include stack traces
- **REL-INV-3**: Add `db.pragma('busy_timeout = 5000')` to `connection.ts`
- **REL-INV-4**: Add shutdown guard boolean in `index.ts` signal handler
- **CQ-INV-12**: Change 4 `string` fields in `types.ts` to union types

### Batch 2: Deterministic fences (currently passing)
- AF-INV-1, AF-INV-3, AF-INV-4, OBS-INV-4, ERR-INV-1, ERR-INV-3,
  SEC-INV-6, SEC-INV-7, OCP-INV-1, DH-INV-2, ARCH-INV-13

### Batch 3: Moderate refactors
- **ERR-INV-7 + ERR-INV-2**: Implement `Result<T, DomainError>` + error boundary
- **API-INV-2**: Add Zod schemas for remaining endpoints
- **ARCH-INV-12**: Remove barrel re-exports
- **LSP-INV-1**: Add `cleanup()` to CliRuntime interface
- **TS-INV-1 + TS-INV-3**: Remove type assertions

### Batch 4: LLM-evaluated + larger refactors
- **AF-INV-5**: Feature-level CLAUDE.md documentation
- **OBS-INV-7**: Duration logging for key operations
- ISP-INV-1, SRP-INV-1, ARCH-INV-11 (structural refactors)

---

## Bugs Found During Evaluation

Two bugs discovered by the evaluation agents:

1. **AgentStore.remove()** (`src/features/live/AgentStore.ts:48`): Passes `sessionId` to
   `this.clientSessions.delete()` instead of the client key. The `for (const [, sessionIds]`
   destructuring discards the key, so the delete uses the wrong identifier.

2. **CopilotRuntime.runHeadless** (`src/shared/infra/runtime/CopilotRuntime.ts:111`): Spawns
   child processes that are never tracked or cleaned up on shutdown, violating the spirit of
   REL-INV-2 even though it passes the existing structural check (which only looks for
   `.unref()` and `detached: true`).

---

## Evaluation Methodology

- **15 Opus 4.6 agents** across 4 rounds
- Round 1: Architecture, Security, Error Handling, Performance, Reliability (4 agents)
- Round 2: SOLID principles -- SRP, OCP+LSP, ISP+DIP (3 agents)
- Round 3: Dead Code, Error Modeling depth, Nullability depth (3 agents)
- Round 4: API Design, Logging/Observability, Code Duplication, Concurrency/Type Safety, Agent-friendliness (5 agents)
- Total raw proposals: 71. After deduplication: 62 unique. Filtered to 22 High/Critical.
