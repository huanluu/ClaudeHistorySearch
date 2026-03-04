# Codebase Scorecard

> Measure → Detect Regression → Climb the Hill
>
> This scorecard is designed for a lone developer fully relying on AI coding agents.
> Agents optimize locally and create global entropy — each session might produce correct
> code that gradually degrades the system. This scorecard catches that drift.
>
> **Two tiers of checks:**
> - **Invariants** (Pass/Fail): Electric fences enforced by lint rules and structural tests.
>   Deterministic, automated, no judgment needed.
> - **Metrics** (Scored 1-5): Hills to climb, evaluated by LLM reading the code.
>   Requires judgment, rubric-guided for consistency.

---

## Summary Dashboard

### Invariants (Pass/Fail)

| Section | Passing | Total | Status |
|---------|---------|-------|--------|
| 1. Architecture | 3 | 7 | Needs work |
| 2. Testability | 1 | 3 | Needs work |
| 3. Observability | 2 | 3 | Good |
| 4. Security | 4 | 4 | Perfect |
| 5. Privacy | 1 | 1 | Perfect |
| 6. Performance | 2 | 3 | Good |
| 7. Reliability | 3 | 3 | Perfect |
| 8. Operability | 2 | 2 | Perfect |
| 9. Code Quality | 1 | 2 | Needs work |
| 10. Agent Ergonomics | 1 | 3 | Needs work |
| **Total** | **20** | **31** | **65%** |

### Metrics (Scored 1-5)

| Section | Avg Score |
|---------|-----------|
| 1. Architecture | 2.7 |
| 2. Testability | 3.0 |
| 3. Observability | 3.3 |
| 4. Security | 3.0 |
| 5. Privacy | 3.8 |
| 6. Performance | 3.3 |
| 7. Reliability | 3.0 |
| 8. Operability | 3.3 |
| 9. Code Quality | 3.7 |
| 10. Agent Ergonomics | 2.0 |
| **Overall Average** | **3.1** |

*Baseline established: 2026-02-16*

---

## 1. Architecture

**Goal:** Maintain clean module boundaries so any agent can change one module without
accidentally coupling to or breaking others.

**What agents tend to break:** Import from the nearest convenient module (wrong layer),
use concrete types (skip interfaces), create `new` objects wherever convenient (bypass
composition root).

### Invariants

#### ARCH-INV-1: Layer Import Direction
> **No file in a lower layer imports from a higher layer.**

- Map each file to its layer: provider(0) → database(1) → services(2) → sessions(3) → transport(4) → api(5)
- `app.ts` and `index.ts` are exempt (composition root / entry point)
- **FAIL** if any import points from a lower-numbered layer to a higher-numbered layer
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-1: Layer Import Direction'` + ESLint `no-restricted-imports`

#### ARCH-INV-2: Barrel Encapsulation
> **All cross-module imports go through `index.ts` barrel files.**

- Cross-module imports must target `../module/index.js`, never `../module/SomeInternal.js`
- Intra-module imports (within the same module) are fine
- **FAIL** if any cross-module import bypasses the barrel
- **Enforced by**: `eslint.config.js` → `@typescript-eslint/no-restricted-imports` (Blocks 1-7) + `tests/scorecard.test.ts` → `'ARCH-INV-2: Barrel Encapsulation'`

#### ARCH-INV-3: No Circular Dependencies
> **No import cycles exist between any modules.**

- Both direct (A→B→A) and transitive (A→B→C→A) cycles count
- **FAIL** if any cycle exists
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-3: No Circular Dependencies'`

#### ARCH-INV-4: Composition Root Monopoly
> **Cross-module class instantiation (`new`) only happens in `app.ts`.**

- Scan all files except `app.ts` and `index.ts` for `new SomeClass(...)` where
  `SomeClass` is imported from a different module
- Factory functions returning interfaces are exempt
- **FAIL** if any cross-module `new` is found outside `app.ts`
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-4: Composition Root Monopoly'` (`it.fails`)

#### ARCH-INV-5: No Import-Time Side Effects
> **Importing a module must not trigger I/O, network, or process operations.**

- Scan module-scope code for: fs operations, `new Database()`, `spawn`, `exec`
- `index.ts` (entry point) is the only exemption
- Pure path computation (`path.join(...)`) is fine; using it to CREATE resources is not
- **FAIL** if any module-scope I/O exists outside `index.ts`
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-5: No Import-Time Side Effects'` (`it.fails`)

#### ARCH-INV-6: Interface-Typed Module Boundaries
> **Every dependency crossing a module boundary is typed as an interface, not a concrete class.**

- Check constructor params, function params, and fields for cross-module types
- `app.ts` is exempt (wires concrete classes by design)
- **FAIL** if any non-app.ts file has a cross-module dependency typed as a concrete class
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-6: Interface-Typed Module Boundaries'` (`it.fails`)

#### ARCH-INV-7: Test Existence Floor
> **Every source module with exported logic has a corresponding test file.**

- For every `.ts` in `src/` exporting functions or classes, a `.test.ts` must exist
- Type-only files and barrel files are exempt
- **FAIL** if any exportable module lacks a test file
- **Enforced by**: `tests/scorecard.test.ts` → `'ARCH-INV-7: Test Existence Floor'` (`it.fails`)

### Metrics

#### ARCH-MET-1: Module Focus (SRP)
> **How well does each module adhere to Single Responsibility?**

| Score | Criteria |
|-------|----------|
| 5 | All files < 200 lines, every class has a single clear responsibility |
| 4 | All files < 300 lines, at most 1 class with 2 concerns |
| 3 | Most files < 300 lines, 2-3 classes with blurred responsibilities |
| 2 | Multiple files > 400 lines, clear God classes present |
| 1 | Files > 500 lines common, classes with 4+ distinct responsibilities |

**Check:** Largest file sizes. For each class, how many "reasons to change"? Classes mixing business logic + I/O, orchestration + parsing, scheduling + data fetching?

#### ARCH-MET-2: Interface Segregation
> **How narrow are interfaces? Do consumers depend only on what they use?**

| Score | Criteria |
|-------|----------|
| 5 | All interfaces < 5 methods, every consumer uses > 80% of methods |
| 4 | Most interfaces < 7 methods, most consumers use > 60% |
| 3 | Some interfaces 7-10 methods, some consumers use < 50% |
| 2 | Fat interfaces (10+ methods) where consumers use < 30% |
| 1 | Massive interfaces, widespread unused-method dependencies |

**Check:** For each interface, list methods. For each consumer, list which methods it actually calls.

#### ARCH-MET-3: Dependency Injection Completeness
> **How cleanly are dependencies injected vs. hard-coded?**

| Score | Criteria |
|-------|----------|
| 5 | All params are interfaces, no default singletons, all wiring in composition root |
| 4 | > 90% interface-typed params, few default singletons |
| 3 | > 70% interface-typed, several default singletons scattered |
| 2 | Many concrete params, default singletons widespread |
| 1 | Most dependencies hard-coded, composition root bypassed regularly |

**Check:** Constructor parameter types. Default values referencing module singletons. `process.env` reads outside composition root.

#### ARCH-MET-4: Side Effect Containment
> **Are I/O operations isolated behind injectable interfaces?**

| Score | Criteria |
|-------|----------|
| 5 | All I/O behind injectable interfaces, zero hard-coded paths in business logic |
| 4 | > 90% behind interfaces, 1-2 hard-coded paths justified |
| 3 | > 70% behind interfaces, several hard-coded I/O in services |
| 2 | Many hard-coded I/O operations scattered in business logic |
| 1 | I/O everywhere, untestable without real filesystem |

**Check:** `fs.*` calls, `child_process.*`, `Date.now()`, hard-coded paths — in injectable implementations or scattered?

#### ARCH-MET-5: Test Effectiveness
> **Do tests verify behavior through public APIs, not implementation details?**

| Score | Criteria |
|-------|----------|
| 5 | > 95% public API covered, all tests use interface injection, zero internal access |
| 4 | > 85% covered, rare implementation-detail testing, clean mock patterns |
| 3 | > 70% covered, some `as unknown as` casts, some tests duplicating internals |
| 2 | > 50% covered, frequent hacky mocks, tests mirror implementation |
| 1 | < 50% covered, tests reach into private state, brittle to refactoring |

**Check:** Count `as unknown as` / `as any` in tests. Do tests access private fields? Duplicate production logic (e.g., SQL)?

#### ARCH-MET-6: Extension Readiness (OCP)
> **Can new behavior be added by creating new code, not modifying existing code?**

| Score | Criteria |
|-------|----------|
| 5 | All dispatch is registry/plugin based, zero hard-coded variant lists |
| 4 | Most extensible, 1-2 small hard-coded dispatch chains |
| 3 | Mixed — some registry patterns, several hard-coded chains |
| 2 | Mostly hard-coded, few extension points |
| 1 | Everything hard-coded, adding features requires modifying 3+ existing files |

**Check:** Count `if/switch` dispatch chains. Hard-coded allowlists. "To add new X, how many existing files change?"

---

## 2. Testability

**Goal:** Every module is testable in isolation. Tests verify behavior, not implementation.
Tests are the safety net that lets agents refactor with confidence.

**What agents tend to break:** Skip writing tests for "simple" changes, test implementation
details instead of behavior, use `as any` to bypass the type system, don't clean up global
state between tests.

### Invariants

#### TEST-INV-1: No Type Escape Hatches in Tests
> **Test files must not use `as any` to bypass type checking on mock construction.**

- `as unknown as Interface` is acceptable when the interface is properly narrow
  (consumer uses all mocked methods)
- `as any` is never acceptable — it hides missing mock methods
- `as unknown as ConcreteClass` indicates a missing interface (report as ARCH-INV-6 violation)
- **FAIL** if any `as any` appears in mock/stub construction in test files
- **Enforced by**: `tests/scorecard.test.ts` → `'TEST-INV-1: No as any in test files'` (`it.fails`) + `eslint.config.js` → `@typescript-eslint/no-explicit-any` (Block 9, warn)

#### TEST-INV-2: No Global State Leaks Between Tests
> **Tests that modify `process.env` or global state must restore it in `afterEach`/`afterAll`.**

- Scan test files for `process.env.X = ...` assignments
- Each must have a corresponding cleanup in `afterEach` or `afterAll`
- Module-scope `process.env` assignments (outside `describe`/`it`) are violations — they
  affect all tests in the file and potentially other test files
- **FAIL** if any `process.env` mutation lacks cleanup
- **Enforced by**: `tests/scorecard.test.ts` → `'TEST-INV-2: No module-scope process.env mutations'` (`it.fails`)

#### TEST-INV-3: Tests Use Public API Only
> **Test files must not import internal module files — only barrels and test utilities.**

- Tests should import from `../src/module/index.js` (barrel), not `../src/module/SomeInternal.js`
- Exception: type-only imports for test setup are acceptable
- Tests must not access private/protected members via `(obj as Record<string, unknown>).field`
- **FAIL** if tests bypass the public API of the module under test
- **Enforced by**: `eslint.config.js` → `@typescript-eslint/no-restricted-imports` (Block 1, applied to test files)

### Metrics

#### TEST-MET-1: Public API Coverage
> **What percentage of exported functions and class methods have direct test coverage?**

| Score | Criteria |
|-------|----------|
| 5 | > 95% of public exports have at least one direct test |
| 4 | > 85% covered, gaps are in low-risk utilities |
| 3 | > 70% covered, some important exports untested |
| 2 | > 50% covered, critical paths (auth, data access) have gaps |
| 1 | < 50% covered, core functionality untested |

**Check:** For each module's barrel exports, trace whether a test exercises that export.

#### TEST-MET-2: Mock Quality
> **Are test doubles clean interface-based fakes or hacky partial casts?**

| Score | Criteria |
|-------|----------|
| 5 | All mocks implement full interfaces, zero `as unknown as` casts |
| 4 | Most mocks are clean, < 3 `as unknown as` casts total |
| 3 | Mixed — some clean mocks, some partial casts (5-10) |
| 2 | Frequent partial casts (10+), mocks routinely skip interface methods |
| 1 | `as any` widespread, mocks don't match any interface |

**Check:** Count `as unknown as ConcreteClass` in test files. Do mocks implement all methods of their interface?

#### TEST-MET-3: Test Isolation
> **Can each test file run independently? Do tests avoid shared mutable state?**

| Score | Criteria |
|-------|----------|
| 5 | Every test creates its own state, zero shared mutables, perfect cleanup |
| 4 | Most tests isolated, 1-2 shared state concerns with proper cleanup |
| 3 | Some shared state, most cleaned up, occasional test order sensitivity |
| 2 | Multiple shared state issues, some tests fail when run in isolation |
| 1 | Tests depend on execution order, global state mutations uncleaned |

**Check:** Module-scope `process.env` mutations. Shared temp directories. Tests that pass only when another test ran first.

---

## 3. Observability

**Goal:** When something goes wrong, logs tell you what happened, where, and why — without
requiring a debugger or code reading.

**What agents tend to break:** Use `console.log` instead of the structured logger, remove
logging to "clean up," add code paths without logging, break structured log format.

### Invariants

#### OBS-INV-1: No Console in Source Code
> **Source files must not use `console.log/warn/error` — use the `Logger` interface.**

- The logger module itself may use `console.*` internally (behind opt-in flag)
- CLI entry points (guarded by `process.argv` checks) are exempt
- **FAIL** if any non-logger, non-CLI source file uses `console.*`
- **Enforced by**: `tests/scorecard.test.ts` → `'OBS-INV-1: No console.* in source files'` + `eslint.config.js` → `no-console` (Block 10)

#### OBS-INV-2: All Error Paths Log Context
> **Every `catch` block must log the error with structured context (not swallow it).**

- `catch` blocks must either: log via `logger.error()`, rethrow, or return an error value
  that the caller logs
- Empty `catch {}` blocks or `catch { /* ignore */ }` are violations
- Intentional suppression must include a comment explaining why
- **FAIL** if any catch block silently swallows errors without logging or documented reason
- **Enforced by**: `tests/scorecard.test.ts` → `'OBS-INV-2: Every catch block logs or rethrows'` (`it.fails`)

#### OBS-INV-3: Health Endpoint Reflects All Subsystems
> **`/health` must check every active subsystem and report degraded status when any fails.**

- Every service started in `app.ts` must have a health indicator in the diagnostics
- Adding a new service without adding its health check is a violation
- **FAIL** if any active subsystem is missing from health/diagnostics output
- **Enforced by**: `tests/scorecard.test.ts` → `'OBS-INV-3: Health reflects all subsystems'` (`it.fails`)

### Metrics

#### OBS-MET-1: Log Coverage
> **Are important code paths (errors, state changes, external calls) logged?**

| Score | Criteria |
|-------|----------|
| 5 | Every error, external call, and state change logged with context |
| 4 | Most important paths logged, 1-2 gaps in edge cases |
| 3 | Happy paths logged, some error paths or external calls missing logs |
| 2 | Logging is sparse, many error paths unlogged |
| 1 | Minimal logging, can't diagnose issues from logs alone |

#### OBS-MET-2: Structured Logging Quality
> **Are log entries structured (parseable), consistent, and queryable?**

| Score | Criteria |
|-------|----------|
| 5 | All logs are structured JSON/JSONL, consistent schema, correlation IDs |
| 4 | All logs structured, consistent format, no correlation IDs |
| 3 | Most logs structured, some inconsistent fields |
| 2 | Mixed structured and unstructured logging |
| 1 | Mostly unstructured text, unparseable |

#### OBS-MET-3: Diagnostics Completeness
> **Does the diagnostics endpoint provide enough detail to troubleshoot without SSH access?**

| Score | Criteria |
|-------|----------|
| 5 | Full system snapshot: uptime, all subsystems, resource usage, recent errors, config |
| 4 | Good coverage: subsystems + recent errors + basic resource info |
| 3 | Partial: some subsystems, limited error history |
| 2 | Minimal: just up/down status |
| 1 | No diagnostics endpoint or empty response |

---

## 4. Security

**Goal:** Prevent unauthorized access, injection attacks, and credential exposure.
Even for a local server, security hygiene prevents accidents and builds good habits.

**What agents tend to break:** Skip input validation on new endpoints, use string
concatenation for shell commands, hardcode secrets, forget auth on new routes.

### Invariants

#### SEC-INV-1: No Hardcoded Secrets
> **No API keys, passwords, tokens, or secrets in source code or config checked into git.**

- Scan source for string literals that look like secrets (API keys, tokens, passwords)
- Check `.gitignore` excludes `config.json`, `.api-key`, and `*.env`
- **FAIL** if any secret value is committed to the repository
- **Enforced by**: `tests/scorecard.test.ts` → `'SEC-INV-1: No hardcoded secrets'`

#### SEC-INV-2: Array-Based Subprocess Arguments
> **All `spawn` calls use array arguments, never shell string interpolation.**

- `spawn(cmd, [arg1, arg2])` is safe — no shell injection
- `exec(userInput)` or `execSync(string)` with user-controlled content is unsafe
- `execSync` with fully hard-coded strings (no user input) is acceptable
- **FAIL** if any `spawn`/`exec` call interpolates user-controlled values into a shell string
- **Enforced by**: `tests/scorecard.test.ts` → `'SEC-INV-2: All spawn() calls use array arguments'`

#### SEC-INV-3: Auth on All Non-Public Endpoints
> **Every HTTP endpoint requires authentication except explicitly declared public paths.**

- Public paths must be declared in a single, auditable list
- Adding a new endpoint without auth and without adding to the public list is a violation
- WebSocket connections must authenticate before receiving data
- **FAIL** if any endpoint is accessible without auth and not in the public paths list
- **Enforced by**: `tests/scorecard.test.ts` → `'SEC-INV-3: All non-public routes are behind auth middleware'`

#### SEC-INV-4: Path Traversal Protection
> **All user-supplied file paths are validated against an allowlist before use.**

- Any endpoint or WebSocket handler that accepts a path from the user must validate
  it through `WorkingDirValidator` or equivalent
- No raw user paths passed to `fs.*` or `spawn` without validation
- **FAIL** if any user-controlled path reaches filesystem operations unvalidated
- **Enforced by**: `tests/scorecard.test.ts` → `'SEC-INV-4: User-supplied paths validated before filesystem use'` (`it.fails`)

### Metrics

#### SEC-MET-1: Input Validation Coverage
> **What percentage of user-facing inputs are validated before use?**

| Score | Criteria |
|-------|----------|
| 5 | Every query param, body field, and WS message field validated with type + range |
| 4 | All critical inputs validated, some non-critical inputs unchecked |
| 3 | Most inputs validated, some string fields passed through unvalidated |
| 2 | Only some inputs validated, no systematic approach |
| 1 | No input validation, raw user input used throughout |

#### SEC-MET-2: Auth Boundary Completeness
> **How consistently is authentication enforced across all entry points?**

| Score | Criteria |
|-------|----------|
| 5 | Single auth middleware covers all routes, explicit public path allowlist, WS auth enforced |
| 4 | Auth middleware covers all routes, WS auth enforced, 1-2 minor gaps |
| 3 | Auth mostly enforced, some routes or WS paths inconsistent |
| 2 | Auth partially implemented, easy to add unprotected endpoints |
| 1 | No auth or trivially bypassable |

#### SEC-MET-3: Dependency Hygiene
> **Are npm dependencies minimal, pinned, and free of known vulnerabilities?**

| Score | Criteria |
|-------|----------|
| 5 | Minimal deps, lock file committed, zero known vulnerabilities, regular audits |
| 4 | Lock file committed, zero critical/high vulns, some outdated deps |
| 3 | Lock file committed, some known vulns but no critical ones |
| 2 | Many deps, some known critical vulns |
| 1 | No lock file, numerous vulnerabilities, unused dependencies |

---

## 5. Privacy

**Goal:** User session data (which may contain sensitive content) is handled carefully.
No PII leaks into logs, no unauthorized access to session content.

**What agents tend to break:** Log request/response bodies containing session data,
expose raw data without access control, store credentials in plaintext.

### Invariants

#### PRIV-INV-3: Session Data Requires Authentication
> **All endpoints returning session content require authentication when auth is enabled.**

- `/sessions`, `/sessions/:id`, `/search` must require auth
- Health and diagnostics endpoints may be public but must not include session content
- **FAIL** if session content is accessible without authentication
- **Enforced by**: `tests/scorecard.test.ts` → `'PRIV-INV-3: Session endpoints are behind auth middleware'`

### Metrics

#### PRIV-MET-1: Data Minimization
> **Does the system collect and expose only what's necessary?**

| Score | Criteria |
|-------|----------|
| 5 | Only essential data indexed, search results return minimal fields, no over-exposure |
| 4 | Mostly minimal, 1-2 fields exposed that aren't strictly necessary |
| 3 | Some unnecessary data exposure, full records returned where summaries would suffice |
| 2 | Over-collection or over-exposure in multiple areas |
| 1 | All data exposed without filtering |

#### PRIV-MET-2: API Key Storage Quality
> **How securely are API keys stored on disk?**

| Score | Criteria |
|-------|----------|
| 5 | Keys stored as salted hashes, plaintext never touches disk, key files have restricted permissions |
| 4 | Keys hashed (SHA-256), plaintext only shown once at generation, config file permissions correct |
| 3 | Keys hashed but salt not used, or plaintext key file not permission-restricted |
| 2 | Keys stored in reversible encoding (base64) or with weak hashing |
| 1 | Plaintext keys stored in config files |

#### PRIV-MET-3: Log Content Hygiene
> **Do logs avoid leaking PII or session content?**

| Score | Criteria |
|-------|----------|
| 5 | Logs contain zero PII/session content, sensitive fields redacted, structured logging with allowlisted fields only |
| 4 | Request logger redacts sensitive params, no session content in logs, occasional metadata in debug level |
| 3 | Most sensitive content excluded but some query params or metadata may leak at verbose log levels |
| 2 | Session metadata visible in logs, some content may appear in error contexts |
| 1 | Session content or user data appears in standard log output |

#### PRIV-MET-4: Access Control Granularity
> **Can different levels of access be configured?**

| Score | Criteria |
|-------|----------|
| 5 | Role-based access, per-resource permissions, audit logging |
| 4 | API key auth with multiple keys possible, read/write distinction |
| 3 | Single API key, all-or-nothing access, basic auth on most endpoints |
| 2 | Auth exists but inconsistently applied |
| 1 | No access control at all |

---

## 6. Performance

**Goal:** The server responds quickly for its use case (local search over local data).
No unnecessary blocking, no unbounded growth, no wasted computation.

**What agents tend to break:** Use sync I/O in request handlers, load entire datasets
into memory, miss database indexes, create O(n^2) loops over session data.

### Invariants

#### PERF-INV-1: No Synchronous I/O in Request Handlers
> **HTTP/WS request handlers must not call synchronous filesystem or process operations.**

- `readFileSync`, `writeFileSync`, `execSync`, `statSync` must not appear in code paths
  triggered by incoming HTTP requests or WebSocket messages
- Module-load-time reads (like loading `admin.html` once) are acceptable
- **FAIL** if any request handler calls sync I/O
- **Enforced by**: `tests/scorecard.test.ts` → `'PERF-INV-1: No sync I/O in request handlers'`

#### PERF-INV-2: Database Queries Use Indexes
> **All user-facing database queries operate on indexed columns.**

- Session listing queries use indexed columns for sorting/filtering
- FTS5 search uses the virtual table (not `LIKE` scans)
- No `SELECT *` on large tables without `LIMIT`
- **FAIL** if `EXPLAIN QUERY PLAN` shows a full table scan on a user-facing query
- **Enforced by**: `tests/scorecard.test.ts` → `'PERF-INV-2: No unindexed queries'`

#### PERF-INV-3: No Unbounded In-Memory Collections
> **No array, map, or buffer grows without limit in long-running code paths.**

- Session store, error buffer, client tracking — all must have capacity limits
- Indexing operations should process files one at a time (stream), not load all into memory
- **FAIL** if any in-memory collection can grow unbounded based on external input
- **Enforced by**: `tests/scorecard.test.ts` → `'PERF-INV-3: No unbounded in-memory collections'` (`it.fails`)

### Metrics

#### PERF-MET-1: Query Efficiency
> **How efficient are database operations?**

| Score | Criteria |
|-------|----------|
| 5 | All queries indexed, streaming where possible, optimal pagination |
| 4 | Most queries indexed, 1-2 minor inefficiencies |
| 3 | Core queries indexed, some N+1 or missing indexes |
| 2 | Multiple unindexed queries, some full table scans |
| 1 | No indexes, full scans common |

#### PERF-MET-2: Startup Efficiency
> **How quickly does the server become ready to serve requests?**

| Score | Criteria |
|-------|----------|
| 5 | < 1s to ready, lazy initialization for expensive operations |
| 4 | < 2s to ready, most initialization parallelized |
| 3 | < 5s, some blocking initialization |
| 2 | 5-15s, synchronous initialization chain |
| 1 | > 15s or unpredictable startup time |

#### PERF-MET-3: Memory Discipline
> **Is memory usage bounded and predictable?**

| Score | Criteria |
|-------|----------|
| 5 | All collections bounded, stream-based processing, explicit cleanup |
| 4 | Most collections bounded, 1-2 potential growth points documented |
| 3 | Some unbounded collections, but practical limits keep them small |
| 2 | Multiple unbounded collections, potential for memory issues |
| 1 | No bounds on collections, memory grows with usage |

---

## 7. Reliability & Fail-Closed Safety

**Goal:** The server handles errors gracefully, cleans up resources, and degrades
instead of crashing. When uncertain, fail closed (deny) rather than open (allow).

**What agents tend to break:** Swallow exceptions in catch blocks, forget to clean up
spawned processes, add code paths without error handling, leave resources open on error.

### Invariants

#### REL-INV-1: No Unhandled Promise Rejections
> **All async operations have error handling. Unhandled rejections terminate the process.**

- `process.on('unhandledRejection')` is registered and calls `process.exit(1)`
- Every `await` in a try/catch or `.catch()` chain
- No fire-and-forget `async` calls without error handling
- **FAIL** if any async call path can produce an unhandled rejection
- **Enforced by**: `tests/scorecard.test.ts` → `'REL-INV-1: Unhandled rejection handler exists'`

#### REL-INV-2: Spawned Processes Tracked and Cleaned
> **Every `child_process.spawn()` call is tracked and terminated on shutdown.**

- SessionExecutor tracks its child process and kills on `cancel()`
- SessionStore tracks all executors and cleans up on client disconnect
- `app.stop()` must terminate all child processes
- **FAIL** if any spawned process can outlive the server
- **Enforced by**: `tests/scorecard.test.ts` → `'REL-INV-2: All spawn() calls assign to tracked variables'`

#### REL-INV-3: Signal Handlers Trigger Graceful Shutdown
> **SIGINT and SIGTERM trigger orderly cleanup: stop services, close connections, exit.**

- Signal handlers registered in `index.ts`
- `app.stop()` called before `process.exit()`
- Database connections closed, timers cleared, WebSocket server shut down
- **FAIL** if Ctrl+C or `kill` leaves resources dangling
- **Enforced by**: `tests/scorecard.test.ts` → `'REL-INV-3: SIGINT and SIGTERM handlers'`

### Metrics

#### REL-MET-1: Error Handling Coverage
> **What percentage of error-prone operations have explicit error handling?**

| Score | Criteria |
|-------|----------|
| 5 | Every I/O, parse, and external call has error handling with recovery strategy |
| 4 | > 90% covered, clear error recovery patterns |
| 3 | > 70% covered, some operations rely on global error handler as fallback |
| 2 | Spotty coverage, some silent failures |
| 1 | Minimal error handling, frequent unhandled errors |

#### REL-MET-2: Graceful Shutdown Completeness
> **Does `app.stop()` clean up everything?**

| Score | Criteria |
|-------|----------|
| 5 | All timers, connections, file watchers, child processes, and listeners cleaned up |
| 4 | Most resources cleaned up, 1-2 minor leaks |
| 3 | Core resources cleaned up, some edge cases missed |
| 2 | Partial cleanup, some resources leaked on shutdown |
| 1 | No graceful shutdown, resources leaked on exit |

#### REL-MET-3: Graceful Degradation
> **Do subsystem failures degrade service instead of crashing the server?**

| Score | Criteria |
|-------|----------|
| 5 | All subsystem failures caught, health endpoint reflects degraded state, service continues with reduced functionality |
| 4 | Critical subsystems degrade gracefully, non-critical failures logged but don't crash |
| 3 | Most errors caught but some subsystem failures may propagate, health endpoint partially reflects state |
| 2 | Main error handlers exist but some subsystem errors can crash the process |
| 1 | Errors propagate freely, any subsystem failure crashes the server |

#### REL-MET-4: Error Context Quality
> **Do errors include enough context to diagnose without reproducing?**

| Score | Criteria |
|-------|----------|
| 5 | Every error includes: what failed, with what input, stack trace, and suggested action |
| 4 | Most errors include what + input + stack |
| 3 | Errors include message + stack, some missing input context |
| 2 | Basic error messages, often missing context |
| 1 | Errors are cryptic or generic ("something went wrong") |

---

## 8. Release & Operability

**Goal:** The server is easy to deploy, monitor, update, and troubleshoot — especially
for a lone developer who needs to quickly diagnose and fix issues.

**What agents tend to break:** Break launchd config, remove or degrade health checks,
make changes that require undocumented manual steps, let CLAUDE.md drift from reality.

### Invariants

#### OPS-INV-1: Server Auto-Restarts on Crash
> **The launchd plist uses `KeepAlive.SuccessfulExit: false` to restart on crashes.**

- Server restarts automatically on non-zero exit
- Server stays down on intentional stop (exit 0) to allow maintenance
- **FAIL** if plist is misconfigured or missing
- **Enforced by**: `tests/scorecard.test.ts` → `'OPS-INV-1: launchd plist has KeepAlive.SuccessfulExit: false'`

#### OPS-INV-2: Log Rotation Prevents Unbounded Growth
> **Log files are rotated before they grow too large.**

- Logger checks file size at startup and rotates if above threshold
- Old logs are renamed, not deleted (for debugging)
- **FAIL** if log files can grow without limit
- **Enforced by**: `tests/scorecard.test.ts` → `'OPS-INV-2: Logger implements log rotation'`

### Metrics

#### OPS-MET-1: Configuration Hot-Reload Coverage
> **What percentage of configuration can be changed without restarting?**

| Score | Criteria |
|-------|----------|
| 5 | All runtime config hot-reloadable, changes take effect immediately |
| 4 | Most config hot-reloadable, 1-2 settings require restart |
| 3 | Some config hot-reloadable (via admin UI), core settings need restart |
| 2 | Most settings require restart |
| 1 | No hot-reload, every change needs restart |

#### OPS-MET-2: Deployment Simplicity
> **How many manual steps to deploy a change?**

| Score | Criteria |
|-------|----------|
| 5 | One command deploys and restarts (or auto-deploys on push) |
| 4 | 2-3 well-documented steps |
| 3 | Manual steps required but documented in CLAUDE.md |
| 2 | Undocumented steps, requires tribal knowledge |
| 1 | Complex multi-step process, easy to get wrong |

#### OPS-MET-3: Documentation Accuracy
> **Does CLAUDE.md accurately describe the current architecture, commands, and conventions?**

| Score | Criteria |
|-------|----------|
| 5 | All CLAUDE.md content verified against code, architecture diagrams match, every command works, updated on every structural change |
| 4 | Most docs accurate, minor inconsistencies in edge cases, commands all work |
| 3 | Core architecture and commands correct but some details stale (e.g., layer relationships, endpoint list incomplete) |
| 2 | Several stale sections, some documented commands broken, architecture diagram outdated |
| 1 | Documentation significantly diverged from actual codebase |

---

## 9. Code Quality

**Goal:** Clean, consistent, self-documenting code that any AI agent can understand
and modify correctly on the first attempt.

**What agents tend to break:** Introduce `any` types, leave dead code, use inconsistent
naming, create overly complex functions, skip TypeScript strict checks.

### Invariants

#### CQ-INV-1: Zero `any` Types in Source Code
> **No explicit `any` type annotations in source files.**

- TypeScript `strict: true` must be enabled (prevents implicit `any`)
- No `as any`, `: any`, `<any>`, or `any[]` in source files
- **FAIL** if any explicit `any` appears in `src/`
- **Enforced by**: `tests/scorecard.test.ts` → `'CQ-INV-1: Zero explicit any types'` + `eslint.config.js` → `@typescript-eslint/no-explicit-any` (Block 8)

#### CQ-INV-2: No Dead Public Exports
> **Every `export` in barrel files is imported by at least one consumer.**

- Scan all barrel `index.ts` files for exports
- Each export must be imported somewhere in `src/` or `tests/`
- Unused exports are dead code that misleads agents about the public API
- **FAIL** if any barrel export has zero consumers
- **Enforced by**: `tests/scorecard.test.ts` → `'CQ-INV-2: No dead barrel exports'` (`it.fails`)

### Metrics

#### CQ-MET-1: Naming Consistency
> **Are naming conventions consistent across the codebase?**

| Score | Criteria |
|-------|----------|
| 5 | Consistent conventions: PascalCase classes, camelCase functions/vars, clear descriptive names |
| 4 | Mostly consistent, 1-2 deviations |
| 3 | Generally consistent within modules, some cross-module inconsistency |
| 2 | Inconsistent naming, some ambiguous or misleading names |
| 1 | No naming convention, names are confusing or misleading |

#### CQ-MET-2: Function Complexity
> **Are functions small and focused, or long and tangled?**

| Score | Criteria |
|-------|----------|
| 5 | All functions < 30 lines, cyclomatic complexity < 5 |
| 4 | Most functions < 50 lines, complexity < 8, 1-2 larger functions |
| 3 | Some functions 50-100 lines, complexity < 12 |
| 2 | Multiple functions > 100 lines, high complexity |
| 1 | Functions > 200 lines, deeply nested, hard to follow |

#### CQ-MET-3: Pattern Consistency
> **Are similar problems solved the same way across the codebase?**

| Score | Criteria |
|-------|----------|
| 5 | One pattern per concern (one DI style, one error pattern, one test pattern) |
| 4 | Mostly consistent, 1-2 alternative patterns |
| 3 | Some inconsistency (e.g., some services use DI, others use singletons) |
| 2 | Multiple competing patterns for the same concern |
| 1 | Every module solves the same problem differently |

---

## 10. Agent Ergonomics

**Goal:** An AI coding agent (Claude Code) can autonomously understand design rationale,
navigate to the right files, implement features following established patterns, and close
the feedback loop by collecting logs/traces to verify its own work — all without human
hand-holding.

This is the meta-section: all other sections measure code quality, but this section measures
how well the codebase **communicates its own quality standards** to the agents working on it.
A codebase can have perfect architecture but if the agent can't discover or understand it,
entropy will still accumulate.

**The three pillars of agent autonomy:**
1. **Understand** — Design rationale, conventions, and constraints are discoverable before making changes
2. **Navigate** — The right files for any task can be found quickly via clear structure and naming
3. **Verify** — The agent can collect logs, run tests, and check its own work without human intervention

**What agents tend to break:** Ignore architectural conventions they can't discover, add
features without following the established checklist, make changes without verifying via
logs/tests, let documentation drift from reality, create code that doesn't match existing
patterns because they never found the patterns.

**Reference:** [Issue #24 — Split CLAUDE.md into docs/ knowledge base](https://github.com/huanluu/ClaudeHistorySearch/issues/24)

### Invariants

#### AE-INV-1: CLAUDE.md as Navigable Map
> **CLAUDE.md must be a concise (< 120 lines) table of contents that points to deeper docs.**

- CLAUDE.md should contain: project overview, quick-start commands, module index, and links
  to detailed docs in `docs/` directory
- It must NOT be a monolithic reference (> 150 lines) that mixes architecture, API reference,
  operations, and testing in one file
- **FAIL** if CLAUDE.md exceeds 150 lines or lacks links to deeper documentation
- **Enforced by**: `tests/scorecard.test.ts` → `'AE-INV-1: CLAUDE.md is under 150 lines'` (`it.fails`)

#### AE-INV-2: Adding-Features Guide Exists and Matches Reality
> **A step-by-step guide for adding new modules/features exists and is accurate.**

- `docs/adding-features.md` (or equivalent) must exist with a concrete checklist:
  create module → define interface → implement → barrel export → ESLint config → wire in
  app.ts → add routes → add tests
- Each step in the checklist must reference the actual file to modify
- The checklist must match the current codebase structure (not stale)
- **FAIL** if no adding-features guide exists, or if it references non-existent files/patterns
- **Enforced by**: `tests/scorecard.test.ts` → `'AE-INV-2: docs/adding-features.md exists'` (`it.fails`)

#### AE-INV-3: Agent Can Collect Diagnostic Data Without Human Help
> **Logs, health status, and diagnostics are accessible to the agent via CLI commands documented in CLAUDE.md.**

- CLAUDE.md or linked docs must document how to:
  - View server logs: `tail -f /tmp/claude-history-server.log`
  - Check server status: `lsof -ti:3847` or `curl localhost:3847/health`
  - Run diagnostics: `curl localhost:3847/diagnostics`
  - Run tests: `npm test`
- These commands must work as documented (no stale paths or missing endpoints)
- **FAIL** if an agent following CLAUDE.md cannot access logs, health, or diagnostics
- **Enforced by**: `tests/scorecard.test.ts` → `'AE-INV-3: CLAUDE.md documents diagnostic commands'`

### Metrics

#### AE-MET-1: Knowledge Base Completeness
> **Does the docs/ directory cover all aspects an agent needs to work autonomously?**

| Score | Criteria |
|-------|----------|
| 5 | Full docs/ directory: architecture, API reference, operations, testing, adding-features, ADRs. Each self-contained. CLAUDE.md is a concise map. |
| 4 | Most topics covered in docs/, CLAUDE.md is a map with links, 1-2 gaps |
| 3 | Some docs exist but CLAUDE.md is still monolithic; agent needs multiple reads to find info |
| 2 | CLAUDE.md is the only doc, > 100 lines, mixes concerns |
| 1 | No CLAUDE.md or stale/misleading documentation |

**Check:** Does `docs/` exist? Does CLAUDE.md link to it? Can an agent find architecture, testing, and operations docs within 1 navigation step?

#### AE-MET-2: Pattern Discoverability
> **Can an agent discover the "right way" to do something by reading existing code?**

| Score | Criteria |
|-------|----------|
| 5 | Every pattern has a golden example referenced in docs; new code can be derived by copying the example |
| 4 | Most patterns have clear examples; adding-features guide points to them |
| 3 | Patterns exist but aren't documented; an agent reading 2-3 files would discover them |
| 2 | Patterns inconsistent; agent would find conflicting examples |
| 1 | No discernible patterns; agent must invent approach from scratch |

**Check:** For each key pattern (DI, barrel exports, interface-first, factory functions, test structure), is there a golden example the agent can copy? Does the adding-features guide reference it?

#### AE-MET-3: Feedback Loop Closure
> **Can the agent verify its own changes without human intervention?**

| Score | Criteria |
|-------|----------|
| 5 | Agent can: run tests, check lint, read logs, hit health endpoint, verify structural invariants — all via documented commands |
| 4 | Most verification automated, 1-2 checks require manual inspection |
| 3 | Tests and lint work, but log inspection or diagnostics require undocumented steps |
| 2 | Tests exist but other verification (logs, health) not agent-accessible |
| 1 | Agent has no way to verify changes without human checking |

**Check:** After making a change, can the agent run `npm test`, `npm run lint`, `curl localhost:3847/health`, and `tail /tmp/claude-history-server.log` to fully verify? Are all these documented?

#### AE-MET-4: Scorecard Integration
> **Is the scorecard itself part of the agent's workflow?**

| Score | Criteria |
|-------|----------|
| 5 | CLAUDE.md links to scorecard; adding-features guide references relevant invariants; structural tests enforce invariants in CI |
| 4 | Scorecard exists and is referenced in docs; most invariants automated |
| 3 | Scorecard exists but not integrated into agent workflow or CI |
| 2 | Scorecard exists but is stale or not referenced anywhere |
| 1 | No scorecard or quality measurement system |

**Check:** Does CLAUDE.md mention SCORECARD.md? Does the adding-features checklist reference scorecard invariants? Do structural tests enforce key invariants?

#### AE-MET-5: Decision Documentation
> **Are non-obvious design decisions documented with rationale?**

| Score | Criteria |
|-------|----------|
| 5 | All non-obvious decisions documented with rationale, alternatives considered, and trade-offs explained |
| 4 | Key decisions documented (e.g., KeepAlive config, barrel pattern), some rationale included |
| 3 | A few decisions documented inline or in CLAUDE.md, but most rationale missing |
| 2 | Some decisions mentioned but without explaining "why", agent would guess wrong on most |
| 1 | No decision documentation, all rationale must be reverse-engineered from code |

---

## Baseline Scores

*Established: 2026-02-16*

### All Invariants

| ID | Invariant | Status | Key Evidence |
|----|-----------|--------|--------------|
| ARCH-INV-1 | Layer Import Direction | PASS | Zero violations across 31 files |
| ARCH-INV-2 | Barrel Encapsulation | PASS | All cross-module imports through barrels |
| ARCH-INV-3 | No Circular Dependencies | PASS | No cycles detected |
| ARCH-INV-4 | Composition Root Monopoly | FAIL | `WebSocketTransport:109`, `SessionStore:14`, `connection.ts:58` |
| ARCH-INV-5 | No Import-Time Side Effects | FAIL | `connection.ts` DB creation, `logger.ts` file writer at import |
| ARCH-INV-6 | Interface-Typed Boundaries | FAIL | 6+ classes without interfaces at module boundaries |
| ARCH-INV-7 | Test Existence Floor | FAIL | Missing: keyManager, middleware, FileWatcher, SqliteSessionRepository |
| TEST-INV-1 | No Type Escape Hatches | FAIL | `config.test.ts:84` uses `as any`; `config-security.test.ts:40,47` uses `as any` |
| TEST-INV-2 | No Global State Leaks | FAIL | `routes.test.ts:25`, `websocket.test.ts:15` mutate `process.env` at module scope |
| TEST-INV-3 | Tests Use Public API Only | PASS | Tests import from barrels (verified by review) |
| OBS-INV-1 | No Console in Source | PASS | Only in logger (opt-in) and keyManager CLI entry point (exempt) |
| OBS-INV-2 | Error Paths Log Context | PASS | All catch blocks log via `logger.error()` with context |
| OBS-INV-3 | Health Reflects Subsystems | FAIL | `getActiveSessionCount` hardcoded to 0 (session store hidden in WS transport) |
| SEC-INV-1 | No Hardcoded Secrets | PASS | API keys generated at runtime, config.json gitignored |
| SEC-INV-2 | Array-Based Subprocess Args | PASS | `spawn('claude', args)` uses arrays; `execSync` calls use hardcoded strings only |
| SEC-INV-3 | Auth on Non-Public Endpoints | FAIL | Auth is optional (disabled by default); when enabled, coverage is complete |
| SEC-INV-4 | Path Traversal Protection | PASS | WorkingDirValidator used for WS session paths |
| PRIV-INV-3 | Session Data Requires Auth | PASS | Session endpoints behind auth middleware when auth enabled |
| PERF-INV-1 | No Sync I/O in Handlers | PASS | `readFileSync` for admin.html is at module load, not per-request |
| PERF-INV-2 | Queries Use Indexes | PASS | FTS5 for search, indexed columns for listing/sorting |
| PERF-INV-3 | No Unbounded Collections | FAIL | `SessionStore` has no capacity limit on tracked sessions |
| REL-INV-1 | No Unhandled Rejections | PASS | `process.on('unhandledRejection')` in index.ts exits with code 1 |
| REL-INV-2 | Spawned Processes Tracked | PASS | SessionExecutor tracks child, SessionStore removes on disconnect |
| REL-INV-3 | Signal Handlers Registered | PASS | SIGINT/SIGTERM handlers call `app.stop()` then exit |
| OPS-INV-1 | Auto-Restart on Crash | PASS | launchd plist `KeepAlive.SuccessfulExit: false` |
| OPS-INV-2 | Log Rotation | PASS | Logger rotates at startup if file > threshold |
| CQ-INV-1 | Zero `any` in Source | PASS | Grep confirmed zero `any` type annotations in src/ |
| CQ-INV-2 | No Dead Public Exports | FAIL | `SessionStore.has()`, `.getByClient()`, `.getAll()` appear unused; `ConfigService.getEditableSectionNames()` potentially unused |
| AE-INV-1 | CLAUDE.md as Navigable Map | FAIL | Root CLAUDE.md is 130+ lines mixing architecture, API, operations, testing. No `docs/` directory exists. |
| AE-INV-2 | Adding-Features Guide | FAIL | No `docs/adding-features.md` exists. Patterns must be reverse-engineered from code. |
| AE-INV-3 | Agent Diagnostic Access | PASS | CLAUDE.md documents log paths, launchd commands, health endpoint, test commands |

**Invariant Summary: 20/31 passing (65%)**

### All Metrics

| ID | Metric | Score | Key Evidence |
|----|--------|-------|--------------|
| ARCH-MET-1 | Module Focus (SRP) | 2 | HeartbeatService 613 lines/6 concerns, WebSocketTransport 487/5, routes 464/7 |
| ARCH-MET-2 | Interface Segregation | 3 | SessionRepository 11 methods (consumers use 1-8), HeartbeatService 12 public methods |
| ARCH-MET-3 | DI Completeness | 3 | Repos+Logger injected; 10+ default singleton locations; ConfigService→HeartbeatService dep |
| ARCH-MET-4 | Side Effect Containment | 2 | connection.ts, logger.ts module-level singletons; keyManager, indexer hard-coded FS |
| ARCH-MET-5 | Test Effectiveness | 3 | database.test.ts duplicates SQL; routes.test.ts reimplements auth; 21 `as unknown as` casts |
| ARCH-MET-6 | Extension Readiness | 3 | Good foundations; 4 hard-coded dispatch chains; monolithic routes |
| TEST-MET-1 | Public API Coverage | 3 | Good breadth; keyManager, middleware, FileWatcher untested; indexAllSessions untested |
| TEST-MET-2 | Mock Quality | 3 | 12 `as unknown as ConcreteClass` casts in routes.test.ts; 3 in diagnosticsService.test.ts |
| TEST-MET-3 | Test Isolation | 3 | Most tests create own state; 2 module-scope env mutations; temp dirs with timestamps |
| OBS-MET-1 | Log Coverage | 4 | All error paths logged; external calls logged; some verbose-only paths |
| OBS-MET-2 | Structured Logging | 3 | JSONL format with timestamp/level; no correlation IDs; consistent schema |
| OBS-MET-3 | Diagnostics Completeness | 3 | Good subsystem coverage; active session count hardcoded to 0; no resource usage |
| SEC-MET-1 | Input Validation | 3 | Query params validated (limit, offset); FTS query sanitized; path validated; some body fields unchecked |
| SEC-MET-2 | Auth Boundary | 3 | Auth middleware exists; optional by default; WS auth implemented; PUBLIC_PATHS hardcoded |
| SEC-MET-3 | Dependency Hygiene | 3 | Lock file committed; moderate dependency count; audit status needs verification |
| PRIV-MET-1 | Data Minimization | 4 | Search returns relevant fields; full messages only via /sessions/:id; query redaction |
| PRIV-MET-2 | API Key Storage Quality | 4 | SHA-256 hash in config.json; plaintext only shown once at generation; config file permissions correct |
| PRIV-MET-3 | Log Content Hygiene | 4 | Request logger redacts sensitive params; no session content in logs; occasional metadata in debug level |
| PRIV-MET-4 | Access Control Granularity | 3 | Single API key, all-or-nothing; no read/write distinction; basic but functional |
| PERF-MET-1 | Query Efficiency | 4 | FTS5 indexed search; session listing uses indexed columns; pagination supported |
| PERF-MET-2 | Startup Efficiency | 3 | Schema migrations run synchronously at import; reindex on first start |
| PERF-MET-3 | Memory Discipline | 3 | Stream-based JSONL parsing; ErrorRingBuffer bounded; SessionStore unbounded |
| REL-MET-1 | Error Handling Coverage | 3 | Most I/O wrapped in try/catch; some fire-and-forget async in app.ts periodic reindex |
| REL-MET-2 | Graceful Shutdown | 4 | app.stop() cleans transport, file watcher, scheduler, timers; DB close missing |
| REL-MET-3 | Graceful Degradation | 2 | FileWatcher error handler exists but other subsystem errors may propagate; health endpoint partially reflects state |
| REL-MET-4 | Error Context Quality | 3 | Structured errors with message; some missing input context; stack traces preserved |
| OPS-MET-1 | Config Hot-Reload | 3 | 3 sections hot-reloadable via admin UI; port/DB path need restart |
| OPS-MET-2 | Deployment Simplicity | 4 | launchd kickstart one-liner; documented in CLAUDE.md |
| OPS-MET-3 | Documentation Accuracy | 3 | Core architecture and commands correct but some details stale (layer relationships, endpoint list) |
| CQ-MET-1 | Naming Consistency | 4 | PascalCase classes, camelCase functions, consistent barrel pattern; minor inconsistencies in test naming |
| CQ-MET-2 | Function Complexity | 3 | createRouter() 400 lines; HeartbeatService.runHeartbeat() ~150 lines; most functions < 50 |
| CQ-MET-3 | Pattern Consistency | 3 | DI pattern inconsistent (some services injected, some use singletons); test patterns vary |
| AE-MET-1 | Knowledge Base Completeness | 2 | No docs/ directory; CLAUDE.md is monolithic 130+ lines mixing all concerns |
| AE-MET-2 | Pattern Discoverability | 2 | Good patterns exist (database/ is exemplary) but not documented; agent must read multiple files to discover |
| AE-MET-3 | Feedback Loop Closure | 3 | Tests + lint work; log paths documented; health endpoint exists; but diagnostic commands scattered across CLAUDE.md |
| AE-MET-4 | Scorecard Integration | 1 | Scorecard exists but not linked from CLAUDE.md; no structural tests enforce it; not in agent workflow |
| AE-MET-5 | Decision Documentation | 2 | Some decisions mentioned (KeepAlive rationale) but without explaining "why" for most choices; agent would guess wrong on layer ordering, FTS5, barrel pattern |

**Metric Summary: 3.0/5 average**

---

## How to Run

### Automated Invariant Checks (runs on every commit via pre-commit hook)

```bash
npm test                    # Runs all tests including scorecard invariants
npm run lint                # ESLint rules enforce per-file invariants
npm run scorecard:report    # Generate full scorecard JSON report
npm run scorecard:save      # Archive baseline + update with latest results
```

### Two-Layer Enforcement

| Layer | Tool | What It Checks |
|-------|------|---------------|
| Per-file rules | ESLint (`npm run lint`) | Import direction, barrel encapsulation, `any` usage, `console` usage |
| Cross-file analysis | Vitest (`npm test`) | Cycles, composition root, side effects, test existence, dead exports, etc. |

### Invariant Automation Coverage

| Status | Count | Invariants |
|--------|-------|------------|
| Passing (`it()`) | 14 | ARCH-INV-2/3, SEC-INV-1/2/3, PRIV-INV-3, PERF-INV-1/2, REL-INV-1/2/3, OPS-INV-1/2, AE-INV-3 |
| Known failures (`it.fails()`) | 12 | ARCH-INV-4/5/6/7, TEST-INV-2, OBS-INV-2/3, SEC-INV-4, PERF-INV-3, CQ-INV-2, AE-INV-1/2 |
| ESLint only | 5 | ARCH-INV-1, CQ-INV-1, TEST-INV-1/3, OBS-INV-1 |
| Metrics (judgment-based) | 5 | PRIV-MET-2/3, REL-MET-3, OPS-MET-3, AE-MET-5 |

### The `it.fails()` Ratchet

Tests marked `it.fails()` represent known violations that are tracked, not ignored:
- They **pass** in Vitest (the expected failure occurs) → CI stays green
- When someone fixes the underlying violation, Vitest says "this test was expected to fail but passed"
- Developer removes `.fails` → invariant is now permanently enforced
- This IS the ratchet — no baseline comparison logic needed

### LLM Evaluation (recommended for metrics)

```
Read all .ts files in server/src/ and server/tests/.
Evaluate the codebase against scorecard/SCORECARD.md.
For each section:
  1. Check each invariant (PASS/FAIL) with specific evidence
  2. Score each metric (1-5) using the rubric
  3. Compare against scorecard/baseline.json and note regressions or improvements
Output: Updated dashboard table, per-item scores, evidence, and delta from baseline.
```

### Tracking Over Time

- `scorecard/baseline.json` — current invariant/metric state
- `scorecard/history/YYYY-MM-DD.json` — archived snapshots
- Run `npm run scorecard:save` to archive + update baseline
- The git history of this file IS the trend line

**Suggested cadence:**
- Run invariant checks: on every commit (automated via pre-commit hook)
- Run full LLM evaluation: monthly or after major refactors
- Run `npm run scorecard:save`: after each evaluation
