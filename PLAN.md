# ClaudeHistorySearch Enhancement Plan

## Status: In Progress

## Overview

Enhance ClaudeHistorySearch with authentication, remote session execution, improved modularity, and critical-path testing.

**User choices:**
- Priority: Authentication first
- Auth: Simple API key
- Streaming: WebSocket
- Testing: Critical paths only

---

## Workflow (Per Phase)

**IMPORTANT:** Follow this process for each phase:

1. **Re-read this PLAN.md** to understand current progress
2. **Create tasks** using `TaskCreate` for all items in the current phase
3. **Implement tasks** - work through each task, marking `in_progress` then `completed`
4. **Run validation** - execute all verification steps listed in the phase
5. **Only after validation passes** - commit changes with descriptive message
6. **Update PLAN.md** - mark phase as complete with date and notes
7. **Proceed to next phase** or wait for user confirmation

---

## Phase 1: Authentication ✅ Complete

### 1.1 Server - API Key Middleware
- [x] Create `server/src/auth/middleware.ts` - Express middleware for X-API-Key header validation
- [x] Create `server/src/auth/keyManager.ts` - Generate, validate, store API keys (hashed with SHA-256)
- [x] Update `server/src/index.ts` - Mount auth middleware before routes
- [x] Update `server/package.json` - Add `npm run key:generate` script
- [x] Add `npm run key:generate` CLI command

### 1.2 iOS - API Key Storage & Headers
- [x] Create `Shared/Sources/ClaudeHistoryShared/Security/KeychainHelper.swift` - Secure key storage
- [x] Update `Shared/Sources/ClaudeHistoryShared/Services/APIClient.swift` - Add API key header
- [x] Update `ClaudeHistorySearch/Views/SessionListView.swift` - iOS Settings with API key input
- [x] Update `ClaudeHistorySearchMac/Views/SettingsView.swift` - macOS Settings with API key input

### 1.3 Verification
- [x] Generate key via `npm run key:generate`
- [x] Test without key (returns 401)
- [x] Test with key (returns data)
- [x] iOS app builds successfully
- [x] macOS app builds successfully

---

## Phase 2: Testing Infrastructure ✅ Complete

### 2.1 Server Tests
- [x] Create `server/jest.config.js`
- [x] Create `server/tests/routes.test.ts` - API endpoints + auth
- [x] Create `server/tests/database.test.ts` - FTS5 queries
- [x] Create `server/tests/__fixtures__/sample-session.jsonl`
- [x] Add jest and supertest to devDependencies

### 2.2 iOS Tests
- [x] Create `Shared/Tests/ClaudeHistorySharedTests/APIClientTests.swift`
- [x] Create `Shared/Tests/ClaudeHistorySharedTests/MockURLProtocol.swift`

### 2.3 Verification
- [x] `npm test` passes (58 tests: 16 routes + 15 database + 27 indexer)
- [x] `swift test` passes (16 tests)

**Note:** Test counts updated after Phase 3 tests were added (see Phase 3.3).

---

## Phase 3: Architecture Modularity ✅ Complete

### 3.1 Server Transport Abstraction
- [x] Create `server/src/transport/Transport.ts` - Base class/interface
- [x] Create `server/src/transport/HttpTransport.ts` - Extract Express logic
- [x] Refactor `server/src/index.ts` to use transport abstraction

### 3.2 iOS Network Protocol
- [x] Create `Shared/Sources/ClaudeHistoryShared/Services/NetworkService.swift` - Protocol
- [x] Refactor `APIClient.swift` to conform to protocol

### 3.3 Tests
- [x] Create `server/tests/transport.test.ts` - HttpTransport tests (21 tests)
- [x] Create `Shared/Tests/ClaudeHistorySharedTests/NetworkServiceTests.swift` - Protocol conformance tests (19 tests)

### 3.4 Verification
- [x] Existing functionality unchanged
- [x] `npm test` passes (79 tests: 16 routes + 15 database + 27 indexer + 21 transport)
- [x] `swift test` passes (35 tests: 16 APIClient + 19 NetworkService)

---

## Phase 3.5: TypeScript Migration ✅ Complete

### 3.5.1 Server TypeScript Conversion
- [x] Add TypeScript, tsx, ts-jest, and type definitions
- [x] Create `server/tsconfig.json` with strict mode
- [x] Convert `database.ts` with typed interfaces (SessionRecord, MessageRecord, etc.)
- [x] Convert `indexer.ts` with types for JSONL parsing
- [x] Convert `routes.ts` with typed API responses
- [x] Convert `auth/keyManager.ts` and `auth/middleware.ts`
- [x] Convert `transport/Transport.ts` and `transport/HttpTransport.ts`
- [x] Convert `index.ts` main entry point
- [x] Update Jest config with ts-jest for TypeScript support

### 3.5.2 Test Files TypeScript Conversion
- [x] Convert `routes.test.js` → `routes.test.ts` with Express types
- [x] Convert `database.test.js` → `database.test.ts` with better-sqlite3 types
- [x] Convert `indexer.test.js` → `indexer.test.ts` with ParsedSession import
- [x] Convert `transport.test.js` → `transport.test.ts` with Express types

### 3.5.3 Verification
- [x] `npm run typecheck` passes with no errors
- [x] `npm test` passes (79 tests)
- [x] Server starts and runs correctly

---

## Phase 4: WebSocket Infrastructure ✅ Complete

### 4.1 Server WebSocket
- [x] Add `ws` package dependency
- [x] Create `server/src/transport/WebSocketTransport.ts`
- [x] Update `server/src/index.ts` for HTTP server + WS
- [x] Update `server/src/auth/keyManager.ts` for test config override

### 4.2 iOS WebSocket Client
- [x] Create `Shared/Sources/ClaudeHistoryShared/Services/WebSocketClient.swift`

### 4.3 Tests
- [x] Create `server/tests/websocket.test.ts` (12 tests)

### 4.4 Verification
- [x] WebSocket connects with auth
- [x] Ping/pong works
- [x] `npm test` passes (91 tests: 16 routes + 15 database + 27 indexer + 21 transport + 12 websocket)
- [x] `swift test` passes (35 tests)

---

## Phase 5: Remote Session Execution ⬚ Not Started

### 5.1 Server Session Executor
- [ ] Add `@anthropic-ai/claude-code` dependency
- [ ] Create `server/src/sessions/SessionExecutor.ts`
- [ ] Create `server/src/sessions/SessionStore.ts`

### 5.2 iOS Session UI
- [ ] Create `ClaudeHistorySearch/Views/RemoteSessionView.swift`
- [ ] Create `ClaudeHistorySearch/Views/SessionOutputView.swift`
- [ ] Create `Shared/Sources/ClaudeHistoryShared/Services/SessionManager.swift`

### 5.3 Verification
- [ ] End-to-end session execution works
- [ ] Streaming output displays
- [ ] Cancel functionality works

---

## Completion Log

| Phase | Status | Completed | Notes |
|-------|--------|-----------|-------|
| 1 | Complete | 2026-01-31 | API key auth for server + iOS/macOS Keychain storage |
| 2 | Complete | 2026-01-31 | Jest + supertest for server (58 tests), Swift Package tests (16 tests) |
| 3 | Complete | 2026-01-31 | Transport abstraction (server) + NetworkService protocol (iOS) + tests (21 transport + 19 NetworkService) |
| 3.5 | Complete | 2026-02-01 | **TypeScript Migration** - Converted all server code to TypeScript |
| 4 | Complete | 2026-02-01 | **WebSocket Infrastructure** - ws package, WebSocketTransport, iOS WebSocketClient + 12 tests |
| 5 | Not Started | - | |

**Current Test Totals:** 91 server tests + 35 Swift tests = 126 total tests
