# Invariants for AI-Assisted Development

> Design principles for a codebase maintained by AI coding agents.
> These are not style preferences. They reduce the cost of uncertainty
> so that aggressive iteration doesn't silently degrade the system.
>
> Some are enforced by tooling (linked to scorecard IDs or ESLint rules).
> Others are agent guidance — principles that shape decisions but can't be linted.

---

## 1. Untrusted input must be validated at the boundary before entering core logic

**Labels:** Architecture, Correctness, Security

Every input from outside the trusted core — HTTP requests, environment variables, database rows, external API payloads, disk files — must be parsed, validated, and normalized at the edge before business logic touches it. Types alone are not runtime truth: TypeScript types disappear at runtime.

**In this codebase:** Query params are validated in route handlers (`features/*/routes.ts`). WebSocket message payloads are validated in handlers. Path inputs go through `WorkingDirValidator`. Environment variables are read only in composition root (`app.ts`, `index.ts`) — enforced by **SEC-INV-5**.

## 2. Transport models and domain models must be separate

**Labels:** Architecture, Refactorability
**Enforcement:** Agent guidance (not linted)

DTOs, JSON payloads, and framework request/response types must not be treated as domain models. A transport shape exists to satisfy an external protocol; a domain model captures internal invariants. Without this separation, accidental API contracts emerge and internal refactors become dangerous.

**In this codebase:** Wire protocol types live in `gateway/protocol.ts`. Domain types live in `shared/provider/types.ts`. Route handlers map between them. The type purity of `types.ts` is enforced by **ARCH-INV-8**.

## 3. Optionality and nullability must be collapsed as early as possible

**Labels:** Correctness, Reliability
**Enforcement:** Agent guidance (not linted)

Nullable and optional values are allowed at the edges but should be converted quickly into either a canonical value, a typed failure, or an explicit domain state. Nullability is contagious — once `T | null` spreads into the core, every caller inherits uncertainty.

**In this codebase:** Route handlers resolve optional query params to defaults before passing to services. TypeScript `strictNullChecks` is enabled in `tsconfig.json`.

## 4. Illegal states should be made unrepresentable in types

**Labels:** Architecture, Correctness
**Enforcement:** Agent guidance (not linted)

When behavior differs meaningfully by state, model it explicitly using enums, discriminated unions, or typed result objects rather than loose strings, booleans, or nullable fields. If the type system can represent invalid states, coding agents will eventually produce them.

**In this codebase:** WebSocket message types use discriminated unions in `gateway/protocol.ts` (each message has a `type` field). Session states in the Mac app use Swift enums.

## 5. Domain and service logic must not depend directly on framework types

**Labels:** Architecture, Testability

Core business logic should not accept or return Express `Request`, raw WebSocket objects, or platform-specific types. It should depend on plain domain inputs and stable interfaces. Framework coupling makes logic harder to test and harder to migrate.

**In this codebase:** Features receive narrow dependency interfaces, not the full Express app or WebSocket server. Enforced by **ARCH-INV-1** (layer import direction) — features cannot import from gateway or infra.

## 6. Cross-cutting concerns must flow through controlled choke points

**Labels:** Architecture, Security, Observability

Authentication, logging, configuration, and feature flags must be introduced through one consistent path: middleware, dependency injection, or a single validated config module. `process.env` everywhere, `console.log` everywhere, and random header reads inside services create invisible coupling.

**In this codebase:** Logging goes through the structured `Logger` interface (enforced by **OBS-INV-1** — no `console.*`). Dependencies are injected via the composition root (enforced by **ARCH-INV-4**). Environment variables are confined to entry points (enforced by **SEC-INV-5**).

## 7. There must be no unchecked escape hatches in production code

**Labels:** Correctness, Security

`any`, unsafe casts, non-null assertions, and silent error swallowing should be forbidden or extremely rare. These constructs are places where the type system has been told to stop protecting you. Agents use them aggressively because they remove friction locally.

**In this codebase:** `any` is banned in source code and tests by ESLint (enforced by **CQ-INV-1**). TypeScript `strict: true` with all strict checks enabled.

## 8. Asynchronous work must have explicit ownership, ordering, and cancellation

**Labels:** Reliability, Performance

Every async task must make it clear who started it, who awaits it, how errors surface, and when it is cancelled. No floating promises. No fire-and-forget without deliberate intent. Async bugs are temporal lies — the system assumes work finished when it's still running.

**In this codebase:** Spawned CLI processes are tracked by `AgentStore` and killed on disconnect (enforced by **REL-INV-2**). The `HeartbeatService` scheduler has explicit start/stop lifecycle.

## 9. Every external side effect must be behind an interface or adapter

**Labels:** Architecture, Testability
**Enforcement:** **ARCH-INV-9** (ESLint Block 7c + scorecard test)

Database access, filesystem writes, network requests, and process spawning should be behind focused abstractions. The point is to localize volatility and create seams for testing, mocking, and future replacement. Features must be **effectless** — they define port interfaces for the I/O they need, and adapters in `shared/infra/` implement those ports.

**In this codebase:** Database access is behind `SessionRepository` and `HeartbeatRepository` interfaces in `shared/provider/types.ts`. CLI execution is behind `CliRuntime`/`AgentSession` interfaces. Feature code is forbidden from importing I/O modules (`fs`, `child_process`, `better-sqlite3`, etc.) — enforced by ESLint. Adapters live in `shared/infra/<technology>/` (organized by what they wrap: `database/`, `runtime/`, `parsers/`). Ports are organized by consumer: cross-cutting in `shared/provider/types.ts`, feature-specific in `features/X/ports.ts`. No module may export singleton instances (enforced by **ARCH-INV-7**).

## 10. API and persistence boundaries must not leak internal representations

**Labels:** Architecture, Security
**Enforcement:** Agent guidance (not linted)

Public responses must be explicit DTOs. Storage models should not cross into transport unchanged. If internal representations leak across boundaries, accidental contracts form and refactors become expensive.

**In this codebase:** The gateway's `protocol.ts` defines wire format types. Repository implementations in `shared/infra/database/` return domain records, not raw SQLite rows.

## 11. One feature should have one obvious source of truth for state

**Labels:** Architecture, Correctness
**Enforcement:** Agent guidance (not linted)

Each workflow or feature should have a single authoritative state model rather than multiple booleans, duplicated caches, and side-loaded singletons. Agents often add flags because it's easy, but each new flag multiplies the number of possible states.

**In this codebase:** Live sessions are tracked by `AgentStore` (single source of truth for active sessions). Configuration is managed by `ConfigService` (single source for runtime config).

## 12. Observability must be designed in, not bolted on later

**Labels:** Observability, Reliability

Important flows must emit structured logs, stable event names, and meaningful error metadata. The goal is not log volume — it's explainability. Without observability, failures become guesswork.

**In this codebase:** Structured JSON logging via the `Logger` interface. `DiagnosticsService` provides system snapshots. Health endpoint reports subsystem status. Console usage is banned in source (enforced by **OBS-INV-1**).

## 13. Architectural dependency direction must be one-way and enforced

**Labels:** Architecture, Refactorability

Higher-volatility layers may depend on lower-volatility layers, but not the reverse. This keeps blast radius small and change local.

**In this codebase:** The 4-layer tree architecture is enforced by ESLint (**ARCH-INV-1**, Blocks 3-7): `shared/provider` → `{gateway, shared/infra, features}` → `app.ts`. Cross-module imports must go through barrels (**ARCH-INV-2**). No circular dependencies (**ARCH-INV-3**).

## 14. Errors must be modeled intentionally and mapped once

**Labels:** Correctness, Reliability
**Enforcement:** Agent guidance (not linted)

Expected business failures should use explicit result types or well-defined domain errors. Exceptional failures may throw, but only into a centralized mapping layer. Random error handling is ambiguity in another form.

**In this codebase:** Route handlers catch errors at the boundary and map to HTTP status codes. The `ErrorRingBuffer` in `DiagnosticsService` tracks recent errors for debugging.

## 15. Infra adapters must be isolated from sibling adapters

**Labels:** Architecture, Refactorability
**Enforcement:** **ARCH-INV-10** (ESLint Blocks 4, 5, 5b)

Infra modules (`shared/infra/<technology>/`) must not import from sibling infra modules. Each adapter depends only on `shared/provider/` (ports). This prevents lateral coupling — if the database adapter changes its connection setup, it should never break the runtime adapter.

**In this codebase:** `shared/infra/database/`, `shared/infra/runtime/`, and `shared/infra/parsers/` are isolated from each other by ESLint rules. Each only imports from `shared/provider/`.

## 16. Tooling must fail the build when invariants are violated

**Labels:** Testability, Security, Maintainability

Important invariants should not depend on memory, taste, or code review alone. They should be encoded into strict compiler settings, lint rules, and structural tests. A codebase maintained with coding agents will evolve too quickly for purely social enforcement to hold.

**In this codebase:** 18 invariants are enforced by ESLint rules and structural tests in `server/scorecard/`. TypeScript `strict: true` with all strict checks. The scorecard uses an `it.fails()` ratchet for known violations — when fixed, the invariant is permanently enforced.

---

## Summary

These invariants serve one meta-goal: **reduce the cost of uncertainty**. Boundary validation reduces uncertainty about inputs. Type modeling reduces uncertainty about states. Controlled cross-cutting concerns reduce uncertainty about hidden dependencies. Observability reduces uncertainty in production. Enforced dependency direction reduces uncertainty during change.

If these invariants hold, the codebase becomes tolerant of aggressive iteration and AI-assisted development without silently degrading over time.
