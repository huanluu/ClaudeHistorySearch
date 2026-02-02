# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude History Search is a system for searching and running Claude Code sessions. It consists of:
- **TypeScript server** (`server/`): Indexes sessions, REST API, WebSocket for live sessions
- **iOS app** (`ClaudeHistorySearch/`): SwiftUI client for iPhone/iPad
- **Mac app** (`ClaudeHistorySearchMac/`): SwiftUI client for macOS
- **Shared package** (`Shared/`): Swift package with shared models, services, and view models

## Development Commands

### Server (TypeScript)
```bash
cd server
npm install        # Install dependencies
npm start          # Start server on port 3847
npm run dev        # Start with auto-reload (--watch)
npm test           # Run Jest tests (118 tests)
```

### iOS/Mac Apps
Open `ClaudeHistorySearch.xcodeproj` in Xcode and build/run.
- Scheme `ClaudeHistorySearch` → iOS app
- Scheme `ClaudeHistorySearchMac` → Mac app

### Shared Package Tests
```bash
cd Shared
swift test         # Run Swift package tests
```

## Architecture

### Server Components (`server/src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Express app entry point, Bonjour advertisement, file watcher |
| `database.ts` | SQLite (better-sqlite3) with FTS5 for full-text search |
| `indexer.ts` | Parses Claude session JSONL files from `~/.claude/projects/` |
| `routes.ts` | REST API endpoints |
| `transport/HttpTransport.ts` | HTTP server wrapper (binds to `0.0.0.0`) |
| `transport/WebSocketTransport.ts` | WebSocket server for live sessions |
| `sessions/SessionExecutor.ts` | Spawns Claude CLI for live sessions |
| `sessions/SessionStore.ts` | Tracks active sessions per client |
| `auth/middleware.ts` | API key authentication middleware |
| `auth/keyManager.ts` | API key generation and validation |

Data flow: JSONL files → indexer → SQLite FTS5 → REST API

### Shared Package (`Shared/Sources/ClaudeHistoryShared/`)

| Component | Purpose |
|-----------|---------|
| `Models/` | Shared data models (Session, Message, SearchResult) |
| `Services/ServerDiscovery.swift` | Bonjour/NWBrowser for server discovery |
| `Services/APIClient.swift` | REST API client (injectable URLSession for testing) |
| `Services/WebSocketClient.swift` | WebSocket client for live sessions |
| `ViewModels/SessionViewModel.swift` | Session state management for live/historical modes |

### iOS/Mac App Components

- **`Views/`**: SwiftUI views for session list, detail, and message display
- **`App.swift`**: App entry point, environment setup

### Key Details

- Server runs on port **3847** and advertises via Bonjour as `_claudehistory._tcp`
- Server binds to `0.0.0.0` (all interfaces) for network accessibility
- Database stored at `~/.claude-history-server/search.db`
- Indexes Claude sessions from `~/.claude/projects/**/*.jsonl`
- Uses SQLite FTS5 with porter stemmer for search
- API key authentication via `X-API-Key` header (optional, enabled when key is set)
- iOS/Mac apps auto-discover server via Bonjour, cache last-known URL

## API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List sessions (pagination via `limit`, `offset`) |
| `/sessions/:id` | GET | Get full conversation |
| `/search?q=term` | GET | Full-text search (`sort=relevance|date`) |
| `/reindex` | POST | Trigger reindex (`force=true` to reindex all) |

### WebSocket Messages (`/ws`)

| Message Type | Direction | Purpose |
|--------------|-----------|---------|
| `auth` | Client → Server | Authenticate with API key |
| `auth_result` | Server → Client | Authentication result |
| `session.start` | Client → Server | Start new Claude session |
| `session.resume` | Client → Server | Resume existing session |
| `session.cancel` | Client → Server | Cancel running session |
| `session.output` | Server → Client | Stream session output |
| `session.error` | Server → Client | Session error |
| `session.complete` | Server → Client | Session finished |

## Testing

```bash
# Server tests (Jest)
cd server && npm test

# Swift package tests
cd Shared && swift test

# Run specific server test
npm test -- --testNamePattern="bind to all interfaces"
```
