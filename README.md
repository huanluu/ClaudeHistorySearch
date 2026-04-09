# Claude History Search

Instantly search and resume your Claude Code sessions from a Mac menu bar app.

A local TypeScript server indexes every Claude Code session transcript (`~/.claude/projects/**/*.jsonl`) into a SQLite FTS5 database. A SwiftUI menu bar app connects to it for fast full-text search and one-click session resumption.

## Quick Setup

```bash
git clone https://github.com/huanluu/ClaudeHistorySearch.git
cd ClaudeHistorySearch
./scripts/setup.sh
```

This single script:
1. Checks prerequisites (Node.js 18+, Xcode, Claude CLI)
2. Installs server dependencies
3. Generates an API key
4. Installs and starts the server as a launchd service (auto-starts at login)
5. Builds the Mac menu bar app and installs it to `/Applications`
6. Verifies everything is running

After setup, enter the API key in the app's settings. Find it with:

```bash
cat ~/.claude-history-server/.api-key
```

## Prerequisites

| Dependency | Version | Install |
|------------|---------|---------|
| **Node.js** | 18+ | `brew install node` |
| **macOS** | 14.0+ (Sonoma) | — |
| **Xcode** | 15+ | Mac App Store |
| **Claude CLI** | Latest | [Install Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) |
| **iTerm2** | Recommended | `brew install --cask iterm2` |

iTerm2 is used to launch and resume sessions in a terminal with smart split-pane layouts. Falls back to Terminal.app if iTerm2 isn't installed.

## Manual Installation

If you prefer to set things up step by step instead of using `setup.sh`:

### Server

```bash
cd server
npm install
npm run key:generate    # Save the printed key — you'll need it in the app
npm start               # Starts on port 3847, indexes all sessions
```

### launchd service (auto-start at login)

```bash
# The setup script creates this automatically, but if doing it manually:
# See scripts/setup.sh for the full plist template
launchctl load ~/Library/LaunchAgents/com.claude-history-server.plist
```

Manage the service:

```bash
launchctl kickstart -k gui/$(id -u)/com.claude-history-server  # restart
launchctl list | grep claude-history-server                      # status
tail -f /tmp/claude-history-server.log                           # logs
```

### Mac app

```bash
xcodebuild -project ClaudeHistorySearch.xcodeproj \
  -scheme ClaudeHistorySearchMac \
  -configuration Release \
  -derivedDataPath build \
  -destination 'platform=macOS' \
  build

cp -R build/Build/Products/Release/ClaudeHistorySearchMac.app /Applications/
open /Applications/ClaudeHistorySearchMac.app
```

Or open `ClaudeHistorySearch.xcodeproj` in Xcode, select **ClaudeHistorySearchMac** scheme, and Cmd+R.

## How It Works

```
┌──────────────────────────────┐
│  Mac Menu Bar App (SwiftUI)  │
│  Search · Browse · Resume    │
└──────────────┬───────────────┘
               │ HTTP + WebSocket
               ▼
┌──────────────────────────────┐
│  Local Server (TypeScript)   │
│  Express · SQLite FTS5 · WS  │
└──────────────┬───────────────┘
               │ watches + indexes
               ▼
   ~/.claude/projects/**/*.jsonl
```

- **Search**: Type a query in the menu bar app, get ranked results across all sessions
- **Browse**: View sessions grouped by project, sorted by date
- **Resume**: Click a session to resume it — the server spawns `claude --resume` and streams output back

## API

```bash
# Health check
curl http://localhost:3847/health

# Search sessions
curl "http://localhost:3847/search?q=swift+concurrency&sort=relevance"

# List sessions
curl http://localhost:3847/sessions?limit=10

# Get a conversation
curl http://localhost:3847/sessions/<session-id>

# Force reindex
curl -X POST http://localhost:3847/reindex?force=true
```

## Data

| Path | Contents |
|------|----------|
| `~/.claude/projects/**/*.jsonl` | Source — Claude Code session transcripts |
| `~/.claude-history-server/search.db` | SQLite FTS5 search index |
| `~/.claude-history-server/config.json` | Server config (API key hash) |
| `~/.claude-history-server/.api-key` | Plaintext API key (for curl/app) |

## Development

```bash
cd server && npm test          # Vitest tests
cd server && npm run lint      # ESLint + architecture boundary enforcement
cd server && npm run typecheck # TypeScript strict mode
cd Shared && swift test        # Swift package tests
```

## License

MIT
