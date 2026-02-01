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

## Phase 5: Refactor Client Views ✅ Complete

**Goal**: Restructure iOS/macOS views to prepare for live session support. Share UI code between platforms.

### 5.1 Tasks
- [x] Extract `MessageListView` - Shared component for displaying session messages
- [x] Extract `MessageRow` - Individual message display with configurable style
- [x] Create `SessionViewModel` - Shell with interface ready for Phase 6
- [x] Rename `SessionDetailView` → `SessionView` - Unified view for historical + live modes
- [x] Add `SessionMode` enum - `.historical` vs `.live` (only historical implemented)
- [x] Add `SessionState` enum - `.idle`, `.running`, `.completed`, `.error`, `.cancelled`

### 5.2 Additional Code Sharing (Bonus)
- [x] Extract `SessionRowContent` - Shared session list row with `.default` / `.compact` styles
- [x] Extract `SearchResultRowContent` - Shared search result row with highlighting
- [x] Unify `SettingsView` - Single view with `#if os()` for platform differences
- [x] Unify `SessionView` - Single view with `#if os()` for platform differences (copy button added to iOS)

### 5.3 Files
**New (Shared):**
- `Shared/Sources/ClaudeHistoryShared/Views/MessageListView.swift`
- `Shared/Sources/ClaudeHistoryShared/Views/MessageRow.swift`
- `Shared/Sources/ClaudeHistoryShared/Views/SessionRowContent.swift`
- `Shared/Sources/ClaudeHistoryShared/Views/SearchResultRowContent.swift`
- `Shared/Sources/ClaudeHistoryShared/Views/SettingsView.swift`
- `Shared/Sources/ClaudeHistoryShared/Views/SessionView.swift`
- `Shared/Sources/ClaudeHistoryShared/ViewModels/SessionMode.swift`
- `Shared/Sources/ClaudeHistoryShared/ViewModels/SessionViewModel.swift`

**Deleted (replaced by shared):**
- `ClaudeHistorySearch/Views/SessionDetailView.swift` (→ shared SessionView)
- `ClaudeHistorySearch/Views/MessageBubbleView.swift`
- `ClaudeHistorySearchMac/Views/SessionDetailView.swift` (→ shared SessionView)
- `ClaudeHistorySearchMac/Views/MessageRowView.swift`
- `ClaudeHistorySearchMac/Views/SearchResultRowView.swift`
- `ClaudeHistorySearchMac/Views/SettingsView.swift`

### 5.4 Verification
- [x] All 35 Swift tests pass
- [x] All 91 server tests pass
- [x] iOS app builds and works
- [x] macOS app builds and works

---

## Phase 6: Start New Session (TDD) ⬚ Not Started

**Goal**: Enable starting a NEW Claude session from iOS/macOS app using `claude -p` headless mode.

**Key Decision**: Use `claude -p` subprocess instead of Agent SDK because:
- Sessions are native Claude Code sessions (saved to `~/.claude/projects/`)
- Resumable from desktop via `claude --resume`
- Automatically searchable by ClaudeHistorySearch
- No SDK dependency needed

### 6.1 TDD Step 1: Write Server Tests FIRST
- [ ] Create `server/tests/sessions.test.ts` - SessionExecutor + SessionStore tests
- [ ] Create `server/tests/websocket-sessions.test.ts` - Integration tests
- [ ] Run tests → See them FAIL (red)

### 6.2 TDD Step 2: Implement Server Features
- [ ] Create `server/src/sessions/SessionExecutor.ts` - Spawns `claude -p`
- [ ] Create `server/src/sessions/SessionStore.ts` - Tracks active sessions
- [ ] Modify `server/src/transport/WebSocketTransport.ts` - Handle session messages
- [ ] Run tests → See them PASS (green)

### 6.3 TDD Step 3: Write Client Tests FIRST
- [ ] Create `Shared/Tests/.../SessionViewModelTests.swift`
- [ ] Run tests → See them FAIL (red)

### 6.4 TDD Step 4: Implement Client Features
- [ ] Fill in `SessionViewModel.swift` - State, messages, startSession(), cancel()
- [ ] Create `ClaudeHistorySearch/Views/NewSessionView.swift` - UI for new session
- [ ] Run tests → See them PASS (green)

### 6.5 Verification
- [ ] `npm test` passes (~20 new tests)
- [ ] `swift test` passes (~7 new tests)
- [ ] Manual E2E: Start session from app, output streams, cancel works

---

## Phase 7: Resume Historical Session (TDD) ⬚ Not Started

**Goal**: Enable resuming a historical session from the session detail view.

```bash
# Resume command:
claude --resume <sessionId> -p "follow-up prompt" --output-format stream-json
```

### 7.1 TDD Step 1: Write Server Tests FIRST
- [ ] Add resume tests to `server/tests/sessions.test.ts`
- [ ] Add resume tests to `server/tests/websocket-sessions.test.ts`
- [ ] Run tests → See them FAIL (red)

### 7.2 TDD Step 2: Implement Server Resume
- [ ] Modify `SessionExecutor.ts` - Add `resumeSessionId` option + `--resume` flag
- [ ] Modify `WebSocketTransport.ts` - Handle `session.resume` message
- [ ] Run tests → See them PASS (green)

### 7.3 TDD Step 3: Write Client Tests FIRST
- [ ] Add resume tests to `SessionViewModelTests.swift`
- [ ] Run tests → See them FAIL (red)

### 7.4 TDD Step 4: Implement Client Resume
- [ ] Add `resumeSession()` to `SessionViewModel.swift`
- [ ] Add "Resume Session" button to `SessionView.swift`
- [ ] Run tests → See them PASS (green)

### 7.5 Verification
- [ ] `npm test` passes (~5 new tests)
- [ ] `swift test` passes (~3 new tests)
- [ ] Manual E2E: Browse history → Resume → See historical + new messages
- [ ] Desktop: `claude --resume <id>` shows continued conversation

---

## Completion Log

| Phase | Status | Completed | Notes |
|-------|--------|-----------|-------|
| 1 | Complete | 2026-01-31 | API key auth for server + iOS/macOS Keychain storage |
| 2 | Complete | 2026-01-31 | Jest + supertest for server (58 tests), Swift Package tests (16 tests) |
| 3 | Complete | 2026-01-31 | Transport abstraction (server) + NetworkService protocol (iOS) + tests (21 transport + 19 NetworkService) |
| 3.5 | Complete | 2026-02-01 | **TypeScript Migration** - Converted all server code to TypeScript |
| 4 | Complete | 2026-02-01 | **WebSocket Infrastructure** - ws package, WebSocketTransport, iOS WebSocketClient + 12 tests |
| 5 | Complete | 2026-02-01 | **View Refactoring + Code Sharing** - MessageRow, MessageListView, SessionViewModel, SessionRowContent, SearchResultRowContent, unified SettingsView |
| 6 | Not Started | - | Start new session (TDD) |
| 7 | Not Started | - | Resume historical session (TDD) |

**Current Test Totals:** 91 server tests + 35 Swift tests = 126 total tests
**Expected After Phase 7:** ~126 server tests + ~45 Swift tests = ~171 total tests
