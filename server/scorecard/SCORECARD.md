# Codebase Scorecard

> 21 invariants. Pass/fail. No judgment needed.
>
> Agents optimize locally and create global entropy — each session might produce correct
> code that gradually degrades the system. These invariants are electric fences that catch drift.
>
> For the design principles behind these invariants, see `docs/invariants.md`.
> For agent procedures (adding/fixing invariants), see `scorecard/CLAUDE.md`.
> For current pass/fail state, see the latest file in `scorecard/history/`.

---

## Architecture (ports-and-adapters, ESLint-enforced)

```
shared/provider/              (effectless: cross-cutting ports — types, contracts, auth, logging)
       |
       +-- gateway/            (effectful: HTTP + WS protocol)
       +-- shared/infra/<tech>  (effectful: adapters organized by technology)
       +-- features/*          (effectless: business logic + feature-only ports)
       |
    app.ts                     (composition root — wires ports to adapters)
```

Features are effectless — no direct I/O. They define port interfaces and receive adapters via injection.
Ports: cross-cutting → `shared/provider/types.ts`, feature-only → `features/X/ports.ts`.
Adapters: always `shared/infra/<technology>/`. All wiring happens in `app.ts`.

---

## Invariants

### Architecture

#### ARCH-INV-1: Layer Import Direction
> No file in a lower layer imports from a higher layer.

- `shared/provider` cannot import from `gateway`, `infra`, or `features`
- `gateway` and `infra` cannot import from `features`
- `features` cannot import from `infra` (use interfaces from `provider`)
- **Enforced by:** `eslint.config.js` Blocks 3-7

#### ARCH-INV-2: Barrel Encapsulation
> All cross-module imports go through `index.ts` barrel files.

- Cross-module imports must target `../module/index`, never `../module/SomeInternal`
- Intra-module imports are fine
- **Enforced by:** `eslint.config.js` Block 1 + `scorecard/tests/architecture.test.ts`

#### ARCH-INV-3: No Circular Dependencies
> No import cycles exist between any modules.

- Both direct (A->B->A) and transitive (A->B->C->A) cycles count
- **Enforced by:** `scorecard/tests/architecture.test.ts`

#### ARCH-INV-4: Composition Root Monopoly
> Cross-module class instantiation (`new`) only happens in `app.ts`.

- No file except `app.ts` and `index.ts` may `new` a class imported from another module
- Factory functions returning interfaces are exempt
- **Enforced by:** `scorecard/tests/architecture.test.ts`

#### ARCH-INV-7: No Exported Singleton Instances
> No module may export a `const` initialized with `new` at module scope.

- Catches `export const db = new Database(...)` — singletons that bypass the composition root
- `app.ts` and `index.ts` are exempt
- **Enforced by:** `scorecard/tests/architecture.test.ts`

#### ARCH-INV-8: Domain Types File Contains Only Types
> `shared/provider/types.ts` must only contain interfaces and type aliases.

- No variables, functions, or classes — only `interface` and `type` declarations
- Prevents contract pollution with runtime values
- **Enforced by:** `scorecard/tests/architecture.test.ts`

#### ARCH-INV-9: Features Must Be Effectless
> Feature code must not import I/O modules directly.

- Features define port interfaces for the effects they need; adapters in `shared/infra/` implement them
- Blocked modules: `fs`, `fs/promises`, `child_process`, `net`, `http`, `https`, `better-sqlite3` (and `node:` prefixed variants)
- Tests are exempt (they may import I/O for mocking/fixtures)
- **Enforced by:** `eslint.config.js` Block 7c + `scorecard/tests/architecture.test.ts`

#### ARCH-INV-10: Infra Sibling Isolation
> Infra modules (`shared/infra/<technology>/`) cannot import from sibling infra modules.

- `shared/infra/database/` cannot import from `shared/infra/runtime/` or `shared/infra/parsers/`
- Each infra module only imports from `shared/provider/` (ports)
- Prevents lateral coupling between adapter implementations
- **Enforced by:** `eslint.config.js` Blocks 4, 5, 5b

### Code Quality

#### CQ-INV-1: Zero `any` Types
> No explicit `any` type annotations in source files or test files.

- TypeScript `strict: true` prevents implicit `any`
- No `as any`, `: any`, `<any>`, or `any[]` anywhere
- **Enforced by:** `eslint.config.js` Block 9 (error in src), Block 9b (error in tests)

#### CQ-INV-3: No .js Extensions in Imports
> TypeScript imports must not use `.js` extensions.

- With `moduleResolution: "Bundler"`, `.js` extensions are unnecessary
- **Enforced by:** `eslint.config.js` Block 8 + `scorecard/tests/code-quality.test.ts`

#### CQ-INV-4: No File Over 400 Lines
> No source file in `src/` may exceed 400 lines.

- Agents grow files instead of extracting — this is the #1 source of entropy
- Test files are exempt
- **Enforced by:** `scorecard/tests/code-quality.test.ts`

#### CQ-INV-5: No Function Over 80 Lines
> No function or method may exceed 80 lines.

- Agents pile code into existing functions instead of extracting
- Forces decomposition before functions become unmaintainable
- **Enforced by:** `scorecard/tests/code-quality.test.ts`

#### CQ-INV-7: TypeScript Typecheck Passes
> `tsc --noEmit` reports zero errors across all source files.

- TypeScript `strict: true` with all strict checks is configured, but only enforced if `tsc` actually runs
- Prevents type drift: added fields, changed signatures, and broken mocks are caught statically
- **Enforced by:** `scorecard/tests/code-quality.test.ts` + pre-commit hook (`npm run typecheck`)

#### CQ-INV-6: Test Existence Floor
> Every source file with exported logic has a co-located `*.test.ts` file.

- Agents add modules without tests — this is the #1 cause of coverage regression
- Skips barrels (`index.ts`), entry point, composition root (`app.ts`), and type-only files
- Matches by source basename: `Foo.ts` → `Foo.test.ts` or `Foo.security.test.ts`
- **Enforced by:** `scorecard/tests/code-quality.test.ts`

### Observability

#### OBS-INV-1: No Console in Source Code
> Source files must not use `console.log/warn/error` — use the `Logger` interface.

- The logger module itself may use `console.*` internally
- CLI entry points (`keyManager.ts`) are exempt
- **Enforced by:** `eslint.config.js` Block 10

### Security

#### SEC-INV-1: No Hardcoded Secrets
> No API keys, passwords, tokens, or secrets in source code.

- Scan for string literals that look like secrets
- `.gitignore` must exclude `config.json`, `.api-key`, `*.env`
- **Enforced by:** `scorecard/tests/security.test.ts`

#### SEC-INV-2: Array-Based Subprocess Arguments
> All `spawn` calls use array arguments, never shell string interpolation.

- `spawn(cmd, [arg1, arg2])` is safe — no shell injection
- `execSync` with user-controlled content is unsafe
- **Enforced by:** `scorecard/tests/security.test.ts`

#### SEC-INV-3: PUBLIC_PATHS Contains Only /health
> The auth middleware's `PUBLIC_PATHS` array must equal exactly `['/health']`.

- No other paths should bypass authentication
- Catches accidental additions to the public path list (e.g., `/admin`)
- **Enforced by:** `scorecard/tests/security.test.ts`

#### SEC-INV-4: No Query-String API Key Auth
> No file in `server/src/` may use `searchParams.get('apiKey')`.

- API keys in URLs leak to logs, proxies, and browser history
- Auth must use the `X-API-Key` header exclusively
- **Enforced by:** `scorecard/tests/security.test.ts`

#### SEC-INV-5: Environment Variable Containment
> `process.env` reads are only allowed in `app.ts`, `index.ts`, and `shared/provider/` config files.

- Prevents environment variable scatter across services
- Services receive configuration via dependency injection, not by reading env vars directly
- **Enforced by:** `scorecard/tests/security.test.ts`

### Reliability

#### REL-INV-2: Spawned Processes Tracked and Cleaned
> Every `child_process.spawn()` call is tracked and terminated on shutdown.

- Spawn calls must be assigned to tracked variables
- No `.unref()` or `detached: true` — these create orphan-capable processes
- `app.stop()` must clean up all child processes
- **Enforced by:** `scorecard/tests/reliability.test.ts`

---

## Two-Layer Enforcement

| Layer | Tool | What It Checks |
|-------|------|---------------|
| Per-file rules | ESLint (`npm run lint`) | Import direction, barrel encapsulation, `any` usage, `console` usage, `.js` extensions, effectless features (I/O imports), adapter isolation |
| Type system | TypeScript (`npm run typecheck`) | Type consistency, missing properties, argument mismatches, null safety, unused variables |
| Cross-file analysis | Vitest (`npm test`) | Cycles, composition root, singletons, type purity, file/function size, secrets, subprocess safety, env containment, process tracking, effectless features, adapter isolation, typecheck |

## How to Run

```bash
npm test                    # Runs all tests including scorecard invariants
npm run lint                # ESLint rules enforce per-file invariants
npx vitest scorecard/tests/architecture.test.ts   # Run one domain
```

## The `it.fails()` Ratchet

Tests marked `it.fails()` represent known violations that are tracked, not ignored:
- They **pass** in Vitest (the expected failure occurs) — CI stays green
- When someone fixes the underlying violation, Vitest says "this test was expected to fail but passed"
- Developer removes `.fails` — invariant is now permanently enforced
- This IS the ratchet — no baseline comparison logic needed
