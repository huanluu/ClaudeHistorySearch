# Assistant Orchestration Layer — Issue Breakdown & Implementation Plan

> Revised after critic review by 3 Opus agents (architecture, testability, scope).

## Overview

Break the assistant orchestration (issue #61 AC3-AC4) into 3 independently shippable issues. Each is a vertical slice: types → implementation → tests → verified.

## Dependency Graph

```
Issue 1: Foundation (types + mock backend + test helpers)
    │
    ▼
Issue 2: AssistantService + handlers + protocol + integration test
    │
    ▼
Issue 3: SdkAssistantBackend + smoke test (real LLM)
```

Linear chain. No premature parallelism (solo engineer can't work two issues at once). Issue 3 comes last when the interface is battle-tested.

## Architecture Decisions (from critic review)

### AD1: Async handler safety
`WsHandler` returns `void`, not `Promise<void>`. The assistant handler is async (`for await`).
**Decision**: Wrap the async iteration in the handler with its own `.catch()` — localized fix, doesn't change gateway contract for existing handlers. Log unhandled errors via logger.

### AD2: Cancellation via AbortSignal
Client disconnect must stop the backend from generating tokens.
**Decision**: `AssistantRunOptions` includes `signal?: AbortSignal`. Handler creates `AbortController`, wires `onDisconnect` → `controller.abort()`. The `for await` loop checks `signal.aborted` and breaks. Backend implementations respect the signal (SdkAssistantBackend kills subprocess).

### AD3: No AssistantOrchestrator interface (dropped)
**Decision**: `AssistantService` is an effectless coordinator in the same feature module as the handler — no cross-boundary concern. The handler takes `AssistantService` directly. The real abstraction boundary is `AssistantBackend` (the port that infra implements). TypeScript structural typing means tests can pass any object with a matching `handleMessage()` without a named interface.

### AD4: Mock lives in test helpers, not shared/infra
**Decision**: `MockAssistantBackend` goes in `tests/__helpers/MockAssistantBackend.ts`. Production code never imports it. `app.ts` uses a config flag to select `SdkAssistantBackend` vs. a simple `EchoAssistantBackend` (a real but trivial implementation for dev mode, not a test mock).

### AD5: Tools deferred
**Decision**: Tool definitions (`AssistantTool`, `ToolResult`, search tools, registry) are out of scope for the initial assistant build. The `AssistantRunOptions.tools` field exists in the type but is optional. Tools will be added in a future issue once the assistant pipeline is working end-to-end.

### AD6: Feature owns its ports, shared/provider for cross-cutting only
**Decision**: `AssistantBackend`, `AssistantEvent`, etc. live in `features/assistant/` — the feature owns its contracts. `shared/provider/types.ts` stays for cross-cutting types (`SessionRepository`, `Logger`, record types). Infra (`shared/infra/assistant/`) uses `import type` from features to implement ports. ESLint updated to allow this (hexagonal pattern).

### AD7: Translation function is truly pure
**Decision**: `translateSdkEvent(message, state)` returns `{ event: AssistantEvent | null, state: TranslationState }` — no mutation. Caller manages state.

### AD8: Session Map bounded + clearable
**Decision**: `AssistantService.sessions` Map has max 100 entries (LRU eviction). `clearConversation(id)` method wired to client disconnect. Known limitation: state lost on server restart.

### AD9: Integration tests use event-driven assertions
**Decision**: Build `waitForMessage(ws, type, timeoutMs)` helper. No `setTimeout`-based flow control.

---

## Issue 1: Assistant Foundation

**Goal**: All types, interfaces, mock backend, and test helpers. Everything needed for Issues 2 and 3 to build against.

**GitHub issue title**: `Assistant foundation: domain types, backend interface, test helpers`

### Files to Create/Modify

#### Types (features/assistant/ports.ts — feature owns its contracts)

```typescript
// ── Assistant domain types (exported via features/assistant/index.ts barrel) ──

interface AssistantEvent {
  type: 'delta' | 'complete' | 'error';
  text?: string;        // present when type === 'delta'
  error?: string;       // present when type === 'error'
  sessionId?: string;   // present when type === 'complete'
}

interface AssistantRunOptions {
  conversationId: string;
  resumeSessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
}

interface AssistantBackend {
  run(prompt: string, options: AssistantRunOptions): AsyncIterable<AssistantEvent>;
}
```

These live in the feature, NOT in `shared/provider/types.ts` (AD6). `shared/infra/assistant/SdkAssistantBackend.ts` does `import type { AssistantBackend } from '../../features/assistant/index'` to implement the port.

#### Mock backend (tests/__helpers/MockAssistantBackend.ts)

- Configurable event sequences per call
- Records calls (prompt, options) for assertion
- Supports delayed yields (for cancellation/concurrency tests)
- `return()` spy for generator cleanup verification

#### Test helper (tests/__helpers/ws-helpers.ts)

- `waitForMessage(ws, type, timeoutMs): Promise<WSMessage>` — event-driven WS assertion helper
- Reusable across Issue 2 integration tests and existing WS tests

#### Barrel exports

- `features/assistant/index.ts` — barrel for the feature module

### TDD Plan

```
Phase 1: Types
  1. Create features/assistant/ports.ts with all interfaces
  2. Export from features/assistant/index.ts barrel
  3. npm run typecheck — compiles
  4. npm run lint — no violations

Phase 2: Mock backend
  1. Write test: MockAssistantBackend yields configured events in order + records calls
     (one focused test, not 3 repetitive ones — critic feedback)
  2. FAIL
  3. Implement MockAssistantBackend
  4. PASS

Phase 3: WS test helper
  1. Write ws-helpers with waitForMessage()
  2. Simple unit test: resolves on matching message, rejects on timeout

Phase 4: Verify
  - npm test — all pass
  - npm run lint — clean
  - npm run typecheck — clean
```

### Verification Checklist
- [ ] Types compile, lint clean
- [ ] MockAssistantBackend yields events, records calls, supports delays
- [ ] waitForMessage helper works
- [ ] No architecture violations (ports in features/assistant, mock in test helpers, infra uses import type from features)

---

## Issue 2: AssistantService + Handlers + Integration Test

**Goal**: The full pipeline from WebSocket message to streamed response. Tested with mock backend — no LLM.

**GitHub issue title**: `Assistant service, WebSocket handlers, and integration test`

**Depends on**: Issue 1

### Files to Create/Modify

#### AssistantService (features/assistant/AssistantService.ts)

- Constructor: `(backend: AssistantBackend, logger: Logger)`
- `handleMessage(text, conversationId, signal?)` → `AsyncIterable<AssistantEvent>`
- Session tracking: `Map<string, string>` (conversationId → sessionId), max 100 entries
- `clearConversation(id)` method
- `stop()` method — aborts all active generators

#### Wire protocol (gateway/protocol.ts additions)

- `AssistantMessagePayload`: `{ conversationId: string, text: string }`
- `AssistantDeltaPayload`: `{ conversationId: string, text: string }`
- `AssistantCompletePayload`: `{ conversationId: string }`
- `AssistantErrorPayload`: `{ conversationId: string, error: string }`
- Zod schemas for validation
- Update `MessageType` union with new types
- Update `payloadSchemas` map

#### Handlers (features/assistant/handlers.ts)

- `registerAssistantHandlers(gateway: WsGateway, deps: AssistantHandlerDeps)`
- `AssistantHandlerDeps`: `{ assistantService: AssistantService, logger: Logger }`
- Handler for `assistant.message`:
  - Creates AbortController
  - Iterates `assistantService.handleMessage()` with signal
  - Sends `assistant.delta`, `assistant.complete`, `assistant.error`
  - Catches `client.send()` errors → breaks loop
  - Wraps in `.catch()` for async safety (AD1)
- Wires `onDisconnect` → abort active conversations for that client

#### Composition (app.ts)

- Conditional backend: config flag `assistant.backend` = `"echo"` | `"sdk"` (default echo for now)
- `EchoAssistantBackend` — trivial real implementation that echoes back the prompt (not a test mock)
- Wire: `AssistantService(backend, logger)` → `registerAssistantHandlers(gateway, { assistantService: service, logger })`

#### Integration test (features/assistant/integration.test.ts)

- Real HttpTransport + WebSocketGateway + mock backend
- Uses `waitForMessage()` helper from Issue 1

### TDD Plan

```
Phase 1: AssistantService unit tests
  1. Write AssistantService.test.ts:
     → Test: yields events from backend
     → Test: passes prompt and conversationId to backend
     → Test: second message same conversationId → passes resumeSessionId
     → Test: different conversationId → independent state
     → Test: backend error event yielded to caller
     → Test: AbortSignal aborted → iteration stops, no more events
     → Test: two concurrent handleMessage calls → session IDs not cross-contaminated
     → Test: session Map bounded at 100 entries (oldest evicted)
     → Test: clearConversation removes entry
     → Test: stop() aborts all active generators
  2. All FAIL
  3. Implement AssistantService
  4. All PASS

Phase 2: Protocol types
  1. Add types + Zod schemas to gateway/protocol.ts
  2. npm run typecheck
  3. Update MessageType union + payloadSchemas

Phase 3: Handler unit tests
  1. Write handlers.test.ts (MockWsGateway pattern):
     → Test: registers 'assistant.message' handler
     → Test: valid payload → calls assistantService.handleMessage
     → Test: delta events → sent as assistant.delta
     → Test: complete event → sent as assistant.complete
     → Test: error event → sent as assistant.error
     → Test: missing conversationId → assistant.error
     → Test: empty text → assistant.error
     → Test: client.send() throws → loop breaks, no crash
     → Test: client disconnect → abort signal fired, iteration stops
     → Test: unknown event type from backend → silently ignored, logged
  2. All FAIL
  3. Implement handlers.ts
  4. All PASS

Phase 4: Integration test
  1. Write integration.test.ts:
     → Test: send assistant.message → receive delta(s) + complete
     → Test: deltas arrive in order
     → Test: multi-turn with same conversationId
     → Test: error from backend → assistant.error
     → Test: unauthenticated → rejected
     → Test: disconnect + reconnect same conversationId → multi-turn preserved
  2. All FAIL (not wired in app.ts)
  3. Wire app.ts with EchoAssistantBackend
  4. All PASS

Phase 5: Verify
  - npm test — all pass (unit + integration)
  - npm run lint — clean
  - npm run typecheck — clean
```

### Verification Checklist
- [ ] Service unit tests pass (session tracking, concurrency, cancellation, bounded map)
- [ ] Handler unit tests pass (all event types, disconnect, error handling)
- [ ] Integration test passes (real WS, full pipeline)
- [ ] `WsHandler` async safety addressed (AD1)
- [ ] Cancellation works (AD2)
- [ ] Handler takes AssistantService directly (AD3 — no extra interface needed)
- [ ] Lint + typecheck clean

---

## Issue 3: SdkAssistantBackend + Smoke Test

**Goal**: Wire the real Claude Agent SDK. The only issue that touches LLM infrastructure.

**GitHub issue title**: `SDK assistant backend adapter and end-to-end smoke test`

**Depends on**: Issue 2

### Pre-work: SDK Spike (Step 0)

Before implementing, validate SDK message shape assumptions:
```typescript
// spike/sdk-event-logger.ts (throwaway, not committed)
// Call query() with includePartialMessages: true
// Log every message's type, subtype, and shape
// Compare against our translateSdkEvent assumptions
```

Run outside Claude Code (CLAUDECODE env var blocks nested sessions).

### Files to Create/Modify

#### SDK adapter (shared/infra/assistant/SdkAssistantBackend.ts)

- Implements `AssistantBackend`
- Only file that imports `@anthropic-ai/claude-agent-sdk`
- `run()` calls `query()` with:
  - `includePartialMessages: true`
  - `resume: options.resumeSessionId`
  - (future: `allowedTools` and `mcpServers` when tools are added)
- Respects `options.signal` — kills subprocess on abort
- Uses `translateSdkEvent()` for event mapping

#### Translation function (shared/infra/assistant/translateSdkEvent.ts)

- Truly pure: `(message, state) => { event, state }` (AD7)
- Handles: system.init, stream_event.text_delta, stream_event.tool_use, result.success, result.error_*
- Returns null for unrecognized events (forward compatible)

#### Contract test (shared/infra/assistant/assistantBackendContract.test.ts)

- Shared behavioral assertions that run against any `AssistantBackend`:
  - Emits at least one event
  - Final event is `complete` or `error`
  - `complete` includes `sessionId`
  - Events arrive in valid sequence (delta* → complete|error)
- Runs against MockAssistantBackend in CI
- Runs against SdkAssistantBackend conditionally (env var `TEST_WITH_SDK=1`)

#### Smoke test script (scripts/test-assistant.ts)

- Connects to running server via WS
- Authenticates
- Two modes:
  - **Interactive**: stdin → assistant.message, stdout ← responses
  - **Scripted**: predefined conversation with structural assertions:
    - Response arrives within 30s
    - Event sequence: delta+ → complete
    - conversationId round-trips correctly
    - Second message gets response (resume works)
- Exit code 0 = all assertions pass, 1 = failure

#### Production wiring (app.ts)

- Config flag: `assistant.backend = "sdk" | "echo"` (default: `"sdk"`)
- `"sdk"` → `new SdkAssistantBackend(logger)`
- `"echo"` → `new EchoAssistantBackend()` (for dev/testing)

### TDD Plan

```
Phase 0: SDK spike
  1. Write throwaway script, run outside Claude Code
  2. Log actual SDK message shapes
  3. Validate/correct our type assumptions

Phase 1: Translation function
  1. Write translateSdkEvent.test.ts:
     → Test: system.init → null event, state gets sessionId
     → Test: stream_event text_delta → delta event with text
     → Test: stream_event tool_use → null (swallowed)
     → Test: result success → complete event with sessionId from state
     → Test: result error_max_turns → error event
     → Test: missing init (no sessionId) → complete with undefined sessionId
     → Test: duplicate init → state updated to latest sessionId
     → Test: unknown message type → null (forward compatible)
     → Test: result before any stream_event → works (edge case)
     → Test: state is not mutated (new state object returned)
  2. All FAIL
  3. Implement translateSdkEvent.ts
  4. All PASS

Phase 2: SdkAssistantBackend
  1. Implement SdkAssistantBackend using translateSdkEvent
  2. npm run typecheck — compiles
  3. Write contract test, run against MockAssistantBackend → PASS
  4. (Optional) Run contract test against SdkAssistantBackend with TEST_WITH_SDK=1

Phase 3: Production wiring
  1. Update app.ts with config-driven backend selection
  2. npm test — all existing tests still pass
  3. npm run lint — clean

Phase 4: Smoke test
  1. Write scripts/test-assistant.ts with structural assertions
  2. Run server in separate terminal (with "sdk" backend)
  3. Run smoke script
  4. Verify: streaming, multi-turn

Phase 5: New dependency
  - npm install @anthropic-ai/claude-agent-sdk
  - Flag per CLAUDE.md dependency rules (ask user permission)
```

### Verification Checklist
- [ ] SDK spike validates message shape assumptions
- [ ] translateSdkEvent fully tested (10 cases including edge cases)
- [ ] State immutability verified (AD7)
- [ ] Contract test passes for MockAssistantBackend
- [ ] SdkAssistantBackend compiles and conforms to interface
- [ ] app.ts config flag works (echo vs sdk)
- [ ] Smoke script passes structural assertions with real LLM
- [ ] New dependency flagged and approved

---

## Known Limitations (Documented, Not Solved)

1. **WS backpressure**: `client.send()` is fire-and-forget. If client is slow, WS write buffer grows. Acceptable for solo user. TODO if it becomes a problem: batch deltas or check `ws.bufferedAmount`.

2. **Conversation state is ephemeral**: Session Map lost on server restart. Acceptable for now. Future: persist to SQLite if needed (AC4).

3. **No `conversationId` in `AssistantEvent`**: Events are scoped to the `handleMessage()` call. Handler attaches conversationId when forwarding to wire protocol. This is intentional — keeps events simple.

4. **Extended thinking disables streaming**: SDK constraint. When `maxThinkingTokens` is set, no `stream_event` messages — only complete messages after each turn.

## Critic Findings Addressed

| Finding | Severity | Resolution | Issue |
|---------|----------|------------|-------|
| WsHandler sync/async mismatch | CRITICAL | Handler wraps in .catch() (AD1) | 2 |
| No cancellation on disconnect | CRITICAL | AbortSignal in RunOptions (AD2) | 2 |
| translateSdkEvent is stateful | CRITICAL | Return new state, no mutation (AD7) | 3 |
| No concurrent conversation test | CRITICAL | Added to service tests | 2 |
| 7 issues too many | IMPORTANT | Collapsed to 3 | All |
| Tools deferred | IMPORTANT | Entire tool layer deferred to future issue (AD5) | — |
| Mock in wrong location | IMPORTANT | Moved to test helpers (AD4) | 1 |
| Types in shared/provider junk drawer | IMPORTANT | Feature owns ports, provider for cross-cutting only (AD6) | 1 |
| Handler on concrete class | IMPORTANT | Dropped — service is effectless, same module, structural typing suffices (AD3) | 2 |
| Session Map unbounded | IMPORTANT | Max 100 + clearConversation (AD8) | 2 |
| Smoke test no assertions | IMPORTANT | Structural assertions added | 3 |
| SDK spike needed | IMPORTANT | Step 0 of Issue 3 | 3 |
| Timeout-based WS tests | IMPORTANT | waitForMessage helper (AD9) | 1 |
| Contract test Mock vs Sdk | IMPORTANT | Shared test suite | 3 |
| client.send() throws | IMPORTANT | Handler catches, breaks loop | 2 |
| MessageType union update | MINOR | Explicit in protocol changes | 2 |
| Zod schema edge cases | MINOR | Empty text, null, type coercion tests | 2 |
| Reconnection test | MINOR | Added to integration test | 2 |
| Graceful shutdown | MINOR | stop() method on service | 2 |
