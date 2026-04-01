# Error Handling Strategy

> How errors are modeled, propagated, and resolved in this codebase.
> This is not a style guide. It is a structural contract that agents must follow.

---

## Core Principle

> **Different kinds of uncertainty require different mechanisms.**

A computation produces one of three outcomes:

```
Optional   ->  value may not exist           ->  T | undefined
Result     ->  operation may fail expectedly  ->  Result<T, E>
throw      ->  system broke or assumption failed  ->  Error
```

Expected outcomes — both success and expected failure — are **values** in the return type.
A "not found" or "validation failed" is not an exception; it is a normal business outcome
modeled via `Result<T, E>`. Unexpected system breakage is a **throw** that propagates to
the error boundary. These two categories must not be mixed.

---

## Error Types

Three error categories, each with a dedicated mechanism:

| Category | When | Mechanism | Example |
|----------|------|-----------|---------|
| **Absence** | Value legitimately doesn't exist | `T \| undefined` | `repo.getById(id)` returns no row |
| **Business failure** | Operation completed, but outcome is failure | `Result<T, DomainError>` | User not found, validation failed, schedule invalid |
| **System failure** | System broke or code has a bug | `throw InfraError` or `throw InvariantError` | DB unavailable, CLI crashed, impossible state |

### Type Definitions

```typescript
// shared/provider/errors.ts

// ── Result type (expected business failures) ────────────
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ── Domain errors (returned in Result, never thrown) ────
// Every variant carries a human-readable `message` for the client
// and a machine-readable `kind` for programmatic dispatch.
type DomainError =
  | { kind: 'not_found'; message: string; entity: string; id: string }
  | { kind: 'validation'; message: string; field: string; reason: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'unauthorized'; message: string };

// Convenience constructors
const notFound = (entity: string, id: string): DomainError =>
  ({ kind: 'not_found', message: `${entity} not found: ${id}`, entity, id });
const validationFailed = (field: string, reason: string): DomainError =>
  ({ kind: 'validation', message: `${field}: ${reason}`, field, reason });

// ── Infra errors (thrown, caught at boundary) ───────────
class InfraError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// ── Invariant errors (thrown, indicates a bug) ──────────
class InvariantError extends Error {
  constructor(message: string) {
    super(`Invariant violation: ${message}`);
  }
}
```

---

## Layer Rules

### Infrastructure (`shared/infra/`)

Adapters interact with databases, filesystems, CLI subprocesses, and external APIs.

| Scenario | Do this |
|----------|---------|
| Lookup returns no row | Return `T \| undefined` |
| Operational failure (DB down, CLI crashed, file unreadable) | `throw new InfraError(message, { cause: originalError })` |
| Malformed external data (single request) | Validate with Zod at boundary; validation failure → structured 400 response |
| Malformed external data (batch/file parsing) | Log warning with context, skip the malformed entry, continue processing. Never crash a batch for one bad record |
| Code assumption broken | `throw new InvariantError(...)` |

**External data validation has two modes:**

- **Request validation** (gateway): Use Zod schemas. Fail fast with a structured error
  response. The client sent bad data — that's a normal outcome, not a crash.
- **File/batch parsing** (parsers): JSONL files from external CLIs may have truncated
  lines or corrupt entries. Log a warning (`logger.warn`) with the file path and line
  number, skip the entry, and continue. Do not throw — one bad line must not block
  indexing thousands of valid sessions.

Infra adapters must **never** return raw technology-specific errors (`SQLITE_BUSY`, `ENOENT`)
to callers. Wrap them in `InfraError` with `{ cause }` to preserve the original.

### Features (`features/*/`)

Features contain effectless business logic. They receive adapters via injection.

| Scenario | Do this |
|----------|---------|
| Repo returns `undefined` and that's a business-meaningful outcome | Return `err({ kind: 'not_found', entity, id })` |
| Input violates business rules | Return `err({ kind: 'validation', field, reason })` |
| Code assumption broken (impossible state) | `throw new InvariantError(...)` |
| Infra dependency throws | **Let it propagate.** Do not catch unless recovering or translating |

Features must **never** `throw new Error('...')` for expected business failures.
Use `Result<T, DomainError>` instead. The compiler then forces callers to handle the failure.

### Boundary (`features/*/routes.ts`, `features/*/handlers.ts`)

Routes and WS handlers are the outer edge of a request. They translate outcomes into protocol responses.

| Scenario | Do this |
|----------|---------|
| `Result` with `ok: false` | Map `DomainError.kind` to HTTP status via `STATUS_MAP` |
| `Result` with `ok: true` | Return `result.value` as response |
| Caught unexpected error | Log once with full context, return 500 |

```typescript
import { z } from 'zod';

// ── Response schema (Zod ensures wire format is a contract) ──
//
// Domain errors (4xx): return `code` + `message` so the client can
// branch on `code` programmatically and display `message` to the user.
// Unexpected errors (500): return generic message only. Never leak
// stack traces, internal state, or infra details to the client.

const ErrorResponseSchema = z.object({
  code: z.string(),              // machine-readable (DomainError.kind or 'internal')
  message: z.string(),           // human-readable (safe to display)
});

const STATUS_MAP: Record<DomainError['kind'], number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  unauthorized: 401,
};

// ── Shared boundary helpers ───────────────────────────────────

function sendDomainError(res: Response, error: DomainError): void {
  res.status(STATUS_MAP[error.kind]).json(
    ErrorResponseSchema.parse({ code: error.kind, message: error.message })
  );
}

function sendUnexpectedError(res: Response, logger: Logger, op: string, error: unknown): void {
  logger.error({ msg: 'Unexpected error', op, err: error, errType: 'internal_error' });
  res.status(500).json(
    ErrorResponseSchema.parse({ code: 'internal', message: 'Internal server error' })
  );
}

// ── Route handler pattern ─────────────────────────────────────

router.get('/cron/jobs/:id', (req, res) => {
  try {
    const result = cronService.getJobStatus(req.params.id);
    if (!result.ok) return sendDomainError(res, result.error);
    res.json(result.value);
  } catch (error) {
    sendUnexpectedError(res, logger, 'cron.getJob', error);
  }
});
```

Using Zod for response construction ensures the error envelope is a verified contract,
not an ad-hoc object literal. The `sendDomainError` and `sendUnexpectedError` helpers
centralize the mapping — routes never construct error responses inline.

---

## Propagation Rules

Thrown errors propagate automatically. **Do not catch unless you are doing one of:**

1. **Recovering** — retry, fallback, or graceful degradation
2. **Translating** — converting a low-level error into a different abstraction
3. **Adding context** — attaching operation-specific meaning (preserve `{ cause }`)

If none apply, let the error propagate. An empty `catch {}` or a catch that only
re-logs is almost always wrong.

---

## Logging Rules

Log where the error is **handled**, not where it is created.

| Location | Log? | Why |
|----------|:----:|-----|
| Throw site | No | Lacks request context |
| Translation site | Maybe | Only if unique context would be lost |
| Recovery/fallback site | Yes | Documents that recovery happened |
| Boundary (route/handler) | Yes | Has full context: request ID, route, op, outcome |

One high-quality structured log at the boundary is better than duplicate low-value
logs scattered across layers.

---

## Quick Decision Flowchart

```
Is the value legitimately absent?
  YES -> return T | undefined

Is this an expected business outcome the caller should handle?
  YES -> return Result<T, DomainError>

Is this a system/infrastructure failure?
  YES -> throw new InfraError(message, { cause })

Is this an impossible state or broken assumption?
  YES -> throw new InvariantError(message)

None of the above?
  -> You probably don't need error handling here.
     Let the value flow through normally.
```

---

## Enforcement

| Invariant | What it checks | Enforcement |
|-----------|---------------|-------------|
| **ERR-INV-7** | Features don't `throw new Error(` — use `Result` or `InvariantError` | Scorecard: regex scan `features/**/*.ts` |
| **ERR-INV-2** | Route catch blocks don't dispatch by `.includes()` on error messages | Scorecard: scan `routes.ts` catch blocks |
| **ERR-INV-4** | Infra wraps tech errors in `InfraError` with `{ cause }` | Scorecard: scan features for tech-specific error properties |
| **ERR-INV-5** | Catch-and-rethrow preserves cause chain | Scorecard: scan for `throw new Error(` inside catch without `{ cause` |

---

## Mental Model

```
Domain decides.        -> Result
Infrastructure fails.  -> throw
Boundary catches.      -> log + respond
```
