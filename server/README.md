# Claude History Server

A local Node.js server that indexes Claude Code session history and provides a searchable REST API.

## Features

- Full-text search across all Claude Code conversations using SQLite FTS5
- Automatic indexing of session history from `~/.claude/projects/`
- File watching for live index updates
- Bonjour/mDNS service advertisement for iOS app discovery

## Installation

```bash
cd claude-history-server
npm install
```

## Usage

```bash
# Start the server
npm start

# Start with auto-reload during development
npm run dev
```

The server runs on port `3847` and advertises itself via Bonjour as `_claudehistory._tcp`.

## API Endpoints

### GET /health
Health check endpoint.

```bash
curl http://localhost:3847/health
```

### GET /sessions
List recent sessions with pagination.

```bash
curl "http://localhost:3847/sessions?limit=20&offset=0"
```

Response:
```json
{
  "sessions": [
    {
      "id": "uuid-here",
      "project": "/Users/huanlu/Developer",
      "startedAt": 1703318400000,
      "messageCount": 42,
      "preview": "First user message..."
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

### GET /sessions/:id
Get full conversation for a session.

```bash
curl http://localhost:3847/sessions/uuid-here
```

### GET /search?q=term
Full-text search across all messages.

```bash
curl "http://localhost:3847/search?q=sqlite&limit=50"
```

Response:
```json
{
  "results": [
    {
      "sessionId": "uuid-here",
      "project": "/Users/huanlu/Developer",
      "sessionStartedAt": 1703318400000,
      "message": {
        "uuid": "msg-uuid",
        "role": "assistant",
        "content": "Full message content...",
        "highlightedContent": "...with <mark>sqlite</mark> highlighted...",
        "timestamp": 1703318500000
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  },
  "query": "sqlite"
}
```

### POST /reindex
Trigger a full reindex of all sessions.

```bash
curl -X POST "http://localhost:3847/reindex?force=true"
```

## Data Storage

- Database: `~/.claude-history-server/search.db`
- Indexes: `~/.claude/projects/` JSONL files

## Requirements

- Node.js 18+
- macOS (for Bonjour service advertisement)
