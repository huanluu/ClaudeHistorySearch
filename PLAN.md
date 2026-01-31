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
- [x] Create `server/src/auth/middleware.js` - Express middleware for X-API-Key header validation
- [x] Create `server/src/auth/keyManager.js` - Generate, validate, store API keys (hashed with SHA-256)
- [x] Update `server/src/index.js` - Mount auth middleware before routes
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

## Phase 2: Testing Infrastructure ⬚ Not Started

### 2.1 Server Tests
- [ ] Create `server/jest.config.js`
- [ ] Create `server/tests/routes.test.js` - API endpoints + auth
- [ ] Create `server/tests/database.test.js` - FTS5 queries
- [ ] Create `server/tests/__fixtures__/sample-session.jsonl`
- [ ] Add jest and supertest to devDependencies

### 2.2 iOS Tests
- [ ] Create `Shared/Tests/ClaudeHistorySharedTests/APIClientTests.swift`
- [ ] Create `Shared/Tests/ClaudeHistorySharedTests/MockURLProtocol.swift`

### 2.3 Verification
- [ ] `npm test` passes
- [ ] Xcode tests pass (Cmd+U)

---

## Phase 3: Architecture Modularity ⬚ Not Started

### 3.1 Server Transport Abstraction
- [ ] Create `server/src/transport/Transport.js` - Base class/interface
- [ ] Create `server/src/transport/HttpTransport.js` - Extract Express logic
- [ ] Refactor `server/src/index.js` to use transport abstraction

### 3.2 iOS Network Protocol
- [ ] Create `Shared/Sources/ClaudeHistoryShared/Services/NetworkService.swift` - Protocol
- [ ] Refactor `APIClient.swift` to conform to protocol

### 3.3 Verification
- [ ] Existing functionality unchanged
- [ ] Tests still pass

---

## Phase 4: WebSocket Infrastructure ⬚ Not Started

### 4.1 Server WebSocket
- [ ] Add `ws` package dependency
- [ ] Create `server/src/transport/WebSocketTransport.js`
- [ ] Update `server/src/index.js` for HTTP server + WS

### 4.2 iOS WebSocket Client
- [ ] Create `Shared/Sources/ClaudeHistoryShared/Services/WebSocketClient.swift`

### 4.3 Verification
- [ ] WebSocket connects with auth
- [ ] Ping/pong works

---

## Phase 5: Remote Session Execution ⬚ Not Started

### 5.1 Server Session Executor
- [ ] Add `@anthropic-ai/claude-agent-sdk` dependency
- [ ] Create `server/src/sessions/SessionExecutor.js`
- [ ] Create `server/src/sessions/SessionStore.js`

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
| 2 | Not Started | - | |
| 3 | Not Started | - | |
| 4 | Not Started | - | |
| 5 | Not Started | - | |
