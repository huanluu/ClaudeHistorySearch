# Claude History Search

A local search system for Claude Code session history. Consists of a TypeScript server that indexes your Claude Code sessions and iOS/Mac apps for searching, browsing, and running live sessions.

## Features

- **Full-text search** across all Claude Code conversations using SQLite FTS5
- **Live sessions** - Start and resume Claude Code sessions from iOS/Mac via WebSocket
- **Automatic indexing** of session history from `~/.claude/projects/`
- **Real-time updates** via file watching (new sessions indexed automatically)
- **Bonjour discovery** - Apps automatically find the server on your local network
- **Remote access** - Access from anywhere via ngrok tunnel
- **Session browsing** - View all sessions grouped by project with pagination
- **Cross-platform** - iOS, iPad, and Mac apps with shared codebase

## Requirements

### Server
- Node.js 18.0.0 or higher
- macOS (for Claude Code session files)
- Claude CLI installed (for live sessions)

### iOS/Mac Apps
- iOS 17.0+ / macOS 14.0+
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
- Advertise via Bonjour as `_claudehistory._tcp` (unless firewall stealth mode is detected)
- Index all existing sessions from `~/.claude/projects/`
- Watch for new sessions and index them automatically

For development with auto-reload:
```bash
npm run dev
```

### 2. Run the iOS/Mac App

Open `ClaudeHistorySearch.xcodeproj` in Xcode:
- **iOS**: Select `ClaudeHistorySearch` scheme, run on device or simulator
- **Mac**: Select `ClaudeHistorySearchMac` scheme, run on Mac

The app will automatically discover the server via Bonjour. You can also manually enter a server URL in Settings.

### 3. Live Sessions (Optional)

The apps support running live Claude Code sessions via WebSocket:

1. Ensure `claude` CLI is installed and in your PATH
2. Connect to server from the app
3. Start a new session or resume an existing one

The server spawns Claude CLI processes and streams output back to the app in real-time.

### Corporate/Work Macs (Stealth Mode)

If your Mac has firewall stealth mode enabled (common on corporate-managed Macs), Bonjour discovery won't work. The server auto-detects this and skips Bonjour advertisement.

**Workaround:** Use your Mac's `.local` hostname instead:

1. Find your Mac's hostname:
   ```bash
   scutil --get LocalHostName
   ```

2. In the iOS app, manually enter:
   ```
   http://YOUR-MAC-NAME.local:3847
   ```

The `.local` hostname uses mDNS for resolution (which still works) and persists across networks - the same URL works at home, office, or anywhere both devices are on the same local network.

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
┌─────────────────────────────────────────────────────────────────┐
│                    iOS / Mac App (SwiftUI)                       │
│  ┌─────────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ ServerDiscovery │  │  APIClient  │  │  WebSocketClient    │  │
│  │   (Bonjour)     │  │   (REST)    │  │  (Live Sessions)    │  │
│  └────────┬────────┘  └──────┬──────┘  └──────────┬──────────┘  │
│           │                  │                    │              │
│           │    Shared Swift Package (Models, Services, VMs)     │
└───────────│──────────────────│────────────────────│──────────────┘
            │                  │                    │
            └────────┬─────────┴────────────────────┘
                     │ HTTP / WebSocket
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    TypeScript Server                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Express   │  │  WebSocket  │  │    Session Executor     │  │
│  │   (REST)    │  │  Transport  │  │    (Claude CLI)         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                     │                 │
│  ┌──────┴────────────────┴─────────────────────┴──────────────┐ │
│  │  Indexer (JSONL) ──► SQLite + FTS5 (better-sqlite3)        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ~/.claude/projects/**/*.jsonl
```

## API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List sessions (`limit`, `offset` for pagination) |
| `/sessions/:id` | GET | Get full conversation by session ID |
| `/search?q=term` | GET | Full-text search (`sort=relevance\|date`) |
| `/reindex` | POST | Trigger reindex (`force=true` to reindex all) |

### WebSocket API (`/ws`)

For live sessions, connect via WebSocket and send JSON messages:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `session.start` | → Server | Start new Claude session |
| `session.resume` | → Server | Resume existing session |
| `session.cancel` | → Server | Cancel running session |
| `session.output` | ← Server | Stream session output |
| `session.complete` | ← Server | Session finished |

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

## Testing

### Server Tests
```bash
cd server
npm test                    # Run all tests (118 tests)
npm test -- --watch         # Watch mode
```

### Swift Package Tests
```bash
cd Shared
swift test                  # Run all tests (~60 tests)
```

Test coverage includes:
- Server interface binding (ensures server is reachable on network)
- Network error handling (connection lost, timeout, etc.)
- Server discovery and URL caching
- REST API response parsing
- WebSocket session management

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
