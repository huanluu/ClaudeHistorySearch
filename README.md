# Claude History Search

A local search system for Claude Code session history. Consists of a Node.js server that indexes your Claude Code sessions and an iOS app for searching and browsing them.

## Features

- **Full-text search** across all Claude Code conversations using SQLite FTS5
- **Automatic indexing** of session history from `~/.claude/projects/`
- **Real-time updates** via file watching (new sessions indexed automatically)
- **Bonjour discovery** - iOS app automatically finds the server on your local network
- **Session browsing** - View all sessions with pagination support

## Requirements

### Server
- Node.js 18.0.0 or higher
- macOS (for Claude Code session files)

### iOS App
- iOS 15.0+
- Xcode 14+

## Getting Started

### 1. Start the Server

```bash
cd server
npm install
npm start
```

The server will:
- Start on port 3847
- Advertise via Bonjour as `_claudehistory._tcp`
- Index all existing sessions from `~/.claude/projects/`
- Watch for new sessions and index them automatically

For development with auto-reload:
```bash
npm run dev
```

### 2. Run the iOS App

Open `ClaudeHistorySearch.xcodeproj` in Xcode and run on your device or simulator.

The app will automatically discover the server via Bonjour. If discovery fails, it falls back to `localhost:3847`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      iOS App (SwiftUI)                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ ServerDiscovery │  │   APIClient     │  │    Views     │ │
│  │   (Bonjour)     │  │   (HTTP)        │  │  (SwiftUI)   │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┘ │
└───────────│────────────────────│────────────────────────────┘
            │                    │
            └────────┬───────────┘
                     │ HTTP/Bonjour
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node.js Server                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │   Express   │  │   Indexer   │  │  SQLite + FTS5       │ │
│  │   Routes    │◄─┤   (JSONL)   │─►│  (better-sqlite3)    │ │
│  └─────────────┘  └──────┬──────┘  └──────────────────────┘ │
└──────────────────────────│──────────────────────────────────┘
                           │
                           ▼
              ~/.claude/projects/**/*.jsonl
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List sessions (`limit`, `offset` for pagination) |
| `/sessions/:id` | GET | Get full conversation by session ID |
| `/search?q=term` | GET | Full-text search across all messages |
| `/reindex` | POST | Trigger reindex (`force=true` to reindex all) |

### Example Requests

```bash
# Health check
curl http://localhost:3847/health

# List sessions
curl http://localhost:3847/sessions?limit=10&offset=0

# Search
curl http://localhost:3847/search?q=swift+concurrency

# Force reindex
curl -X POST http://localhost:3847/reindex?force=true
```

## Data Storage

- **Database**: `~/.claude-history-server/search.db`
- **Source**: `~/.claude/projects/**/*.jsonl`

## License

MIT
