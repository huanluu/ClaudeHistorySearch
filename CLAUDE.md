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

## Server Management (launchd)

The server runs as a launchd agent: `com.claude-history-server`

```bash
# Restart the server (single command)
launchctl kickstart -k gui/$(id -u)/com.claude-history-server

# Restart AND reload plist changes
launchctl unload ~/Library/LaunchAgents/com.claude-history-server.plist && launchctl load ~/Library/LaunchAgents/com.claude-history-server.plist

# Check status (PID in first column, - means not running)
launchctl list | grep claude-history-server

# View logs
tail -f /tmp/claude-history-server.log    # stdout
tail -f /tmp/claude-history-server.err    # stderr
```

The plist uses `KeepAlive > SuccessfulExit: false` — the server auto-restarts on crashes (non-zero exit) but stays down when stopped intentionally (exit 0). Do NOT change this to `KeepAlive: true` as it would prevent manual stop-edit-restart workflows.

**IMPORTANT**: When testing the server locally, do NOT use a different port. Kill the running server first (`launchctl kickstart -k` or `lsof -ti:3847 | xargs kill`), then start with `npm start`. The iOS/Mac apps and Bonjour discovery are hardcoded to port 3847.

## Worktree Discipline
- Only edit files in the worktree branch, never in main directly — avoids merge conflicts
- Never regenerate API keys or do other destructive actions during testing without asking

## Testing Server from a Worktree

launchd always runs from main (`/Users/huanlu/Developer/ClaudeHistorySearch/server`). To test worktree changes:

1. Kill the launchd server: `lsof -ti:3847 | xargs kill`
2. Do NOT use `launchctl kickstart/load/unload` — that restarts from main, not the worktree
3. Tell the user to run this in a **separate terminal** (outside Claude Code):
   ```
   cd /path/to/worktree/server && npm start
   ```
   Running from inside Claude Code inherits `CLAUDECODE` env var, which blocks spawning `claude` subprocesses.
4. After merging to main, restart launchd for production: `launchctl kickstart -k gui/$(id -u)/com.claude-history-server`

Always verify which server is running: `lsof -ti:3847 | xargs ps -p`

## Testing

```bash
# Server tests (Jest)
cd server && npm test

# Swift package tests
cd Shared && swift test

# Run specific server test
npm test -- --testNamePattern="bind to all interfaces"
```
