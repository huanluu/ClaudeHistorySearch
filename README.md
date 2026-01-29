# Claude History Search

A local search system for Claude Code session history. Consists of a Node.js server that indexes your Claude Code sessions and an iOS app for searching and browsing them.

## Features

- **Full-text search** across all Claude Code conversations using SQLite FTS5
- **Automatic indexing** of session history from `~/.claude/projects/`
- **Real-time updates** via file watching (new sessions indexed automatically)
- **Bonjour discovery** - iOS app automatically finds the server on your local network
- **Remote access** - Access from anywhere via ngrok tunnel
- **Session browsing** - View all sessions grouped by project with pagination

## Requirements

### Server
- Node.js 18.0.0 or higher
- macOS (for Claude Code session files)

### iOS App
- iOS 17.0+
- Xcode 15+

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

The app will automatically discover the server via Bonjour. You can also manually enter a server URL in Settings.

## Remote Access (iPhone Outside Local Network)

To access your Claude history from anywhere, use ngrok to create a secure tunnel:

### Setup (one-time)

1. Install ngrok:
   ```bash
   brew install ngrok
   ```

2. Sign up at https://dashboard.ngrok.com/signup and get your authtoken

3. Configure ngrok:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```

### Start Remote Access

1. Start the server:
   ```bash
   cd server && npm start
   ```

2. Start ngrok tunnel:
   ```bash
   ngrok http 3847
   ```

3. Copy the `https://xxx.ngrok-free.dev` URL

4. In the iOS app, go to Settings → Manual Connection and enter the URL

**Note:** Free ngrok URLs change when you restart the tunnel. For a persistent URL, use ngrok's paid plan or set up a Cloudflare Tunnel with your own domain.

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

## Customization

### App Icon

The app icon is generated programmatically. To modify it:

```bash
# Edit generate_icon.py to change colors/design
python3 generate_icon.py
```

Then rebuild the app in Xcode.

## License

MIT
