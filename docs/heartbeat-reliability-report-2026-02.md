# HeartbeatService Reliability Report

**Date:** 2026-02-10
**Severity:** P0 — System-wide resource exhaustion
**Status:** Diagnosed, fixes proposed

---

## 1. Incident Summary

On 2026-02-10, the Claude History Search server's HeartbeatService caused a complete system resource exhaustion on the host machine. The service spawned **16 simultaneous `claude -p` headless sessions**, each analyzing Azure DevOps work items against a large monorepo (`/Volumes/Office/Office2/src`). Each Claude session independently launched ~20 subprocess searches (`grep -r`, `find`, `ripgrep`), resulting in **~240 concurrent processes** competing for disk I/O and CPU.

### Impact

| Metric | Normal | During Incident |
|--------|--------|-----------------|
| Load average | 2-4 | **28.5** |
| CPU idle | ~80% | **2.3%** |
| Total search processes | 0 | **~240** |
| Active Claude sessions | 0-3 | **16** |
| System responsiveness | Normal | **Unusable** (menu bar app hung, UI frozen) |

### Timeline

- **T+0min:** HeartbeatService triggered, spawning Claude sessions to analyze work items
- **T+~5min:** Multiple heartbeat cycles accumulated sessions (in-memory state lost between restarts)
- **T+~20min:** User noticed system unresponsiveness and menu bar app hang
- **T+~25min:** Manual investigation via `ps` revealed 16 `claude -p` processes with ~240 children
- **T+~27min:** Manual `kill` of all heartbeat processes restored system health
- **T+~30min:** Load average began recovering (28.5 → 18.5 → normal)

### Secondary Impact: Menu Bar App Hang

The ClaudeHistorySearchMac menu bar app (PID 10029) was simultaneously consuming 98.7% CPU. The app was rendering a session containing raw HTML from an Azure DevOps work item. The combination of large `AttributedString` content + `.textSelection(.enabled)` in SwiftUI caused the main thread to block on text layout calculations. This is a separate but related issue — the heartbeat sessions produce these HTML-heavy sessions that the app then struggles to render.

---

## 2. Root Cause Analysis

The incident was caused by **six compounding failures** in the HeartbeatService architecture:

### 2.1 Fire-and-Forget Process Spawning (`child.unref()`)

**File:** `server/src/services/HeartbeatService.ts:391`

```typescript
child.unref();
resolve(sessionId);
```

After extracting the session ID from Claude's init message, the service calls `child.unref()` which:
- Removes the child process from Node.js's event loop reference count
- Makes the process invisible to the parent server
- Prevents any lifecycle tracking (no exit handler, no timeout, no cleanup)
- Allows the process and ALL its descendants to become orphans on server restart

**This is the single most dangerous line in the codebase.** It converts a managed child process into an untracked, unkillable orphan.

### 2.2 In-Memory State Lost on Restart

**File:** `server/src/services/HeartbeatService.ts:116`

```typescript
private processedState: Map<string, string> = new Map();
```

The `processedState` Map tracks which work items have been processed. Being in-memory, it is lost on every server restart. When the server restarts (via `launchctl kickstart -k` or crash recovery), ALL work items appear as "new" and are reprocessed. This explains how 16 sessions accumulated — multiple heartbeat cycles each believed all items were unprocessed.

The irony: a `heartbeat_state` SQLite table already exists in the database schema (`database.ts:124-130`) with prepared statements exported and ready to use. It was never wired up.

### 2.3 Loop Counter Instead of System-Wide Concurrency Limit

**File:** `server/src/services/HeartbeatService.ts:469`

```typescript
if (result.sessionsCreated >= HeartbeatService.MAX_SESSIONS_PER_HEARTBEAT) {
    break;
}
```

`MAX_SESSIONS_PER_HEARTBEAT = 3` limits sessions created **per heartbeat run**, not sessions **currently alive**. If a previous run's sessions are still running (which they are — analyses take 5-10+ minutes), the next run happily spawns 3 more. After N heartbeat cycles: `N * 3` concurrent sessions.

### 2.4 No Session Timeout

There is no timeout on spawned Claude sessions. A session analyzing a large monorepo can run indefinitely. If Claude enters a deep search loop (which it does — the prompt encourages it), there is no circuit breaker.

### 2.5 Prompt Encourages Unbounded Search

**File:** `server/src/services/HeartbeatService.ts:329-346`

```typescript
Please analyze this work item in the context of the codebase:
1. Identify relevant code files and modules
```

"Identify relevant code files and modules" is an open invitation for Claude to run `grep -r`, `find`, and `ripgrep` across the entire working directory. With `--dangerously-skip-permissions`, there are zero guardrails. Each session independently discovers the codebase from scratch, spawning 15-25 subprocesses against the massive Office monorepo.

Additionally, raw HTML from Azure DevOps descriptions is passed directly, wasting ~50% of input tokens on `<div>`, `<span>`, inline CSS, and tracking markup.

### 2.6 No Observability

The health endpoint always returns `{"status": "ok"}` regardless of system state. There is:
- No active session count
- No process tracking
- No load monitoring
- No lifecycle logging (spawn/complete/timeout/kill events)
- No way to discover the problem without manual `ps` investigation

---

## 3. Proposed Solutions

Solutions are organized into three phases by priority and grouped by the engineering perspective that identified them.

### Phase 1: Stop the Bleeding (P0)

These changes prevent a recurrence of today's exact incident.

#### 3.1.1 Replace `child.unref()` with a Managed Process Pool

**Perspective:** Architecture + Observability

Create a `SessionRegistry` / `HeartbeatProcessPool` that tracks every spawned Claude session from birth to death:

```typescript
interface ManagedSession {
  sessionId: string;
  pid: number;
  workItemId: number;
  workItemTitle: string;
  startedAt: number;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  completedAt?: number;
  exitCode?: number;
  childProcessRef: ChildProcess;  // Keep ref instead of unref()
  timeoutHandle: NodeJS.Timeout;
}
```

Key behaviors:
- **No `unref()`** — keep the reference so Node.js tracks the child
- **Per-session timeout** (default 10 minutes) with automatic kill
- **Active count gating** — `canAcceptMore()` checks live sessions, not loop count
- **Auto-cleanup** on child exit

#### 3.1.2 Spawn with Process Group Isolation

**Perspective:** Architecture

Spawn Claude sessions with `detached: true` to create a new process group:

```typescript
const child = spawn('claude', args, {
  detached: true,  // Creates new process group
  // ... other options
});
```

This enables `process.kill(-child.pid, 'SIGTERM')` to kill the entire process tree — Claude AND all its spawned grep/find/ripgrep children. Currently, killing the parent leaves ~20 orphan search processes per session.

#### 3.1.3 Session Timeout with Forced Kill

**Perspective:** Architecture + Testing

Add a hard timeout (10 minutes) per session:

```typescript
const timeoutHandle = setTimeout(() => {
  process.kill(-session.pid, 'SIGTERM');
  setTimeout(() => {
    try { process.kill(-session.pid, 'SIGKILL'); } catch {}
  }, 5000);  // Force kill after 5s grace period
}, SESSION_TIMEOUT_MS);
```

#### 3.1.4 Graceful Shutdown Kills Active Sessions

**Perspective:** Architecture + Observability

The server's shutdown handler must kill all active heartbeat sessions:

```typescript
const shutdown = async (): Promise<void> => {
  clearInterval(heartbeatTimer);
  heartbeatService.getProcessPool().killAll('server shutdown');
  await new Promise(resolve => setTimeout(resolve, 2000));
  // ... rest of shutdown
};
```

#### 3.1.5 Strip HTML from Work Item Descriptions

**Perspective:** Prompt Tuning

Clean Azure DevOps HTML before including in prompts:

```typescript
private stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

Impact: reduces token waste by ~50% on descriptions, produces cleaner session content that doesn't break the Mac app's text rendering.

#### 3.1.6 Add Critical Invariant Tests

**Perspective:** Testing

Two tests that would have prevented this incident:

**Test: MAX_SESSIONS enforcement**
```typescript
it('should not spawn more than MAX_SESSIONS_PER_HEARTBEAT sessions', async () => {
  // Setup: 10 work items, all new
  // Assert: spawnCount === MAX_SESSIONS_PER_HEARTBEAT (3)
});
```

**Test: Concurrent heartbeat rejection**
```typescript
it('should reject concurrent heartbeat runs', async () => {
  // Fire two heartbeats simultaneously via Promise.all
  // Assert: one succeeds, one rejected with "already in progress"
});
```

---

### Phase 2: Prevent Recurrence (P1)

These changes address systemic reliability gaps that could cause similar incidents through different vectors.

#### 3.2.1 SQLite-Backed State Persistence

**Perspective:** Architecture + Testing

Replace the in-memory `processedState` Map with the existing `heartbeat_state` database table:

```typescript
recordProcessedItem(key: string, lastChanged: string): void {
  upsertHeartbeatState.run(key, lastChanged, Date.now());
}

getProcessedItemState(key: string): string | undefined {
  const row = getHeartbeatState.get(key);
  return row?.last_changed;
}
```

This prevents the restart-reprocessing storm that caused session accumulation. The table and prepared statements already exist — they just need to be wired up.

#### 3.2.2 System-Wide Concurrency Check

**Perspective:** Architecture

Replace the loop counter with a live session count:

```typescript
// Before (counts this run only):
if (result.sessionsCreated >= MAX_SESSIONS) break;

// After (counts ALL live sessions):
if (!this.processPool.canAcceptMore()) {
  logger.log(`Global session limit reached (${this.processPool.activeCount})`);
  break;
}
```

#### 3.2.3 Orphan Cleanup on Startup

**Perspective:** Architecture + Observability

On server start, check for stale session entries in the database and kill any still-alive processes:

```typescript
async cleanupOrphans(): Promise<void> {
  const stale = db.prepare('SELECT * FROM heartbeat_active_sessions').all();
  for (const entry of stale) {
    try {
      process.kill(entry.pid, 0);  // Check if alive
      process.kill(-entry.pid, 'SIGTERM');  // Kill process group
    } catch {} // Already dead
    db.prepare('DELETE FROM heartbeat_active_sessions WHERE work_item_id = ?')
      .run(entry.work_item_id);
  }
}
```

#### 3.2.4 Enriched Health Endpoint

**Perspective:** Observability

Replace the static `{"status": "ok"}` with a meaningful health check:

```typescript
router.get('/health', (_req, res) => {
  const active = registry.getActive();
  const [load1m] = os.loadavg();

  let status = 'healthy';
  if (active.length > MAX_SESSIONS) status = 'degraded';
  if (load1m > os.cpus().length * 2) status = 'unhealthy';

  res.status(status === 'unhealthy' ? 503 : 200).json({
    status,
    heartbeat: { activeSessions: active.length },
    system: { loadAverage: os.loadavg(), cpuCount: os.cpus().length }
  });
});
```

#### 3.2.5 Heartbeat Metrics Endpoint

**Perspective:** Observability

Add `/heartbeat/metrics` for the admin dashboard showing:
- Active sessions (PID, work item, duration)
- Recent completed sessions (exit code, duration)
- Aggregate stats (total spawned, completed, failed, timed out, avg duration)
- Heartbeat run history (count, last run, next run)

#### 3.2.6 Circuit Breaker for Azure DevOps

**Perspective:** Testing

If `az boards query` fails 3 times consecutively, stop trying for 5 minutes:

```typescript
if (this.circuitBreaker.failures >= 3) {
  if (Date.now() - this.circuitBreaker.lastFailure < 300000) {
    throw new Error('Circuit breaker open: Azure DevOps calls suspended');
  }
  this.circuitBreaker.state = 'half-open';
}
```

#### 3.2.7 Spawn Timeout for Session ID Extraction

**Perspective:** Testing

If Claude doesn't emit a session ID within 10 seconds, kill the process and move on:

```typescript
const SPAWN_TIMEOUT_MS = 10000;
const timeout = setTimeout(() => {
  if (!resolved) {
    resolved = true;
    child.kill('SIGTERM');
    resolve(null);
  }
}, SPAWN_TIMEOUT_MS);
```

---

### Phase 3: Optimize (P2)

These changes reduce cost and resource usage even when everything is working correctly.

#### 3.3.1 Two-Phase Prompt: Triage Then Analyze

**Perspective:** Prompt Tuning

**Phase 1 — Triage (cheap, no tool use):**
- Batch ALL work items into a single session
- Use Haiku model (~60x cheaper)
- Explicitly instruct: "Do NOT use any tools"
- Output: JSON classification with complexity and relevant modules
- Cost: ~$0.01 per batch

**Phase 2 — Deep Analysis (only for complex items):**
- Only for items marked `needs_deep_analysis: true`
- Use Sonnet model (capable but not Opus-expensive)
- Include pre-computed codebase context
- Constrain: "Do NOT run grep, find, or recursive searches. Read at most 5 files."
- Cost: ~$0.10-0.30 per item

**Expected impact:**

| Metric | Current | After |
|--------|---------|-------|
| Sessions per heartbeat (16 items) | 16 (broken) / 3 (intended) | 1 triage + 2-3 deep |
| Subprocesses per session | ~20 | 0 (triage), ~5 (deep) |
| Total processes per heartbeat | 60+ | ~16 |
| Token waste from HTML | ~30-50% | ~0% |
| Cost per heartbeat cycle | 3x Opus | 1x Haiku + 2-3x Sonnet |

#### 3.3.2 Pre-Computed Codebase Context

**Perspective:** Prompt Tuning

Generate a compact codebase summary once per heartbeat cycle and inject into every prompt. This eliminates Claude's need to run file-discovery commands:

```typescript
private async buildCodebaseContext(): Promise<string> {
  const tree = execSync('find . -type f \\( -name "*.ts" -o -name "*.swift" \\) | head -200',
    { cwd: this.config.workingDirectory, encoding: 'utf-8' });
  return `## Codebase Structure (pre-computed)\n${tree}`;
}
```

#### 3.3.3 Load-Aware Back-Pressure

**Perspective:** Architecture

Skip spawning new sessions if system load exceeds threshold:

```typescript
canAcceptMore(): boolean {
  if (this.activeSessions.size >= this.maxConcurrent) return false;
  const [load1m] = os.loadavg();
  if (load1m > os.cpus().length * 0.8) return false;
  return true;
}
```

#### 3.3.4 Structured Logging with Session Correlation

**Perspective:** Observability

Add lifecycle logging at every session state transition:

```
[Heartbeat:start]    runId=1 workItems=5 sessionsToCreate=3
[Heartbeat:spawn]    sessionId=abc123 workItemId=12345 pid=45678
[Heartbeat:complete] sessionId=abc123 exitCode=0 durationMs=299000
[Heartbeat:stale]    sessionId=def456 runningForMs=2100000 threshold=1800000
[Heartbeat:kill]     sessionId=def456 signal=SIGTERM
```

#### 3.3.5 Property-Based Invariant Tests

**Perspective:** Testing

Using a library like `fast-check`:
- For any N work items where N > MAX_SESSIONS, spawned count <= MAX_SESSIONS
- For any sequence of heartbeat runs, total spawned <= total unique work items
- After graceful shutdown, active process count === 0

---

## 4. Missing Test Coverage

The existing test suite (1,083 lines, ~30 tests) covers config, parsing, and basic integration well. The following critical scenarios are untested:

| Missing Test | Why It Matters | Priority |
|---|---|---|
| MAX_SESSIONS enforcement with >3 items | **The exact invariant that failed** | P0 |
| Concurrent `runHeartbeat()` calls | Validates the `isRunning` lock | P0 |
| Hanging Claude session (no init message) | Currently hangs forever | P0 |
| State loss across service restarts | Proves the reprocessing bug | P1 |
| Deferred items processed on next run | Validates deferral correctness | P1 |
| Session kill-on-shutdown | Proves no orphaned processes | P1 |
| Circuit breaker state transitions | Validates failure backoff | P1 |
| `recordProcessedItem` timing (before vs after completion) | Item marked processed before analysis finishes | P2 |
| Config hot-reload during active run | TOCTOU race condition | P2 |

---

## 5. Architectural Principle

The fundamental design error was treating a **long-running, resource-intensive external process** as if it were a **fire-and-forget HTTP request**. Claude sessions running against a large monorepo take 5-10+ minutes and spawn dozens of sub-processes. They require the same lifecycle management given to any long-running job:

- **Tracking** — know what's running, since when, consuming how much
- **Timeouts** — hard ceiling on execution time
- **Cancellation** — ability to kill a session and all its children
- **Persistence** — survive process restarts
- **Observability** — expose state to humans and monitoring systems
- **Back-pressure** — stop accepting work when overloaded

The `child.unref()` on line 391 explicitly opts out of ALL of these properties. Removing it and replacing with a managed process pool is the single highest-impact change.

---

## 6. Implementation Sequence

```
Week 1 (P0): Stop the bleeding
├── Remove child.unref(), add SessionRegistry
├── Add detached:true + process group kill
├── Add 10-minute session timeout
├── Add graceful shutdown → killAll()
├── Strip HTML from descriptions
├── Write invariant tests (MAX_SESSIONS, concurrent rejection)
└── Verify: existing tests pass + new tests pass

Week 2 (P1): Prevent recurrence
├── Wire up heartbeat_state SQLite table
├── System-wide concurrency check (live count)
├── Orphan cleanup on startup
├── Enrich /health endpoint
├── Add /heartbeat/metrics endpoint
├── Add circuit breaker for az CLI
└── Add spawn timeout (10s for session_id)

Week 3+ (P2): Optimize
├── Two-phase prompt (triage + deep analysis)
├── Pre-computed codebase context
├── Load-aware back-pressure
├── Structured logging
└── Property-based tests
```

---

## Appendix A: Process Snapshot During Incident

```
PID=11427  CPU=0.1%  Age=25:45  Work Item #9493709   (18 child processes)
PID=12943  CPU=0.7%  Age=25:26  Work Item #10196511  (27 child processes)
PID=13529  CPU=0.6%  Age=25:16  Work Item #10220741  (28 child processes)
PID=14613  CPU=0.2%  Age=25:02  Work Item #10820887  (34 child processes)
PID=15628  CPU=2.5%  Age=24:46  Work Item #11059111  (39 child processes)
PID=16660  CPU=0.0%  Age=24:31  Work Item #10128414  (6 child processes)
PID=18133  CPU=1.5%  Age=24:09  Work Item #10554109  (32 child processes)
PID=20222  CPU=2.6%  Age=23:39  Work Item #10841283  (29 child processes)
PID=23108  CPU=0.2%  Age=23:17  Work Item #10702882  (18 child processes)
PID=31962  CPU=0.3%  Age=22:41  Work Item #10695711  (18 child processes)
PID=41381  CPU=0.0%  Age=21:48  Work Item #10181889  (20 child processes)
PID=44687  CPU=0.3%  Age=21:31  Work Item #9826624   (35 child processes)
PID=51518  CPU=5.1%  Age=20:53  Work Item #10592722  (23 child processes)
PID=58346  CPU=0.0%  Age=20:22  Work Item #10755877  (14 child processes)
PID=62509  CPU=0.0%  Age=19:53  Work Item #10702951  (22 child processes)
PID=65763  CPU=0.3%  Age=19:31  Work Item #8387762   (4 child processes)
──────────────────────────────────────────────────────────────────────
TOTAL: 16 sessions, ~367 processes, load average 28.5
```

## Appendix B: Debate Team Contributors

This report synthesizes position papers from four specialized advocates:

| Advocate | Perspective | Key Contribution |
|----------|------------|------------------|
| **Observability & Monitoring** | Visibility, health checks, logging | SessionRegistry design, enriched /health endpoint, lifecycle logging |
| **Resource Management & Architecture** | Process lifecycle, concurrency, persistence | ProcessPool, detached spawn, SQLite state, graceful shutdown |
| **Testing & Reliability** | Test gaps, failure modes, invariants | Missing test inventory, circuit breaker, failure mode analysis |
| **Prompt Tuning & Efficiency** | Prompt engineering, cost optimization | Two-phase triage, HTML stripping, codebase context injection |
