# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude History Search is a system for searching Claude Code session history. It consists of:
- **Node.js server** (`server/`): Indexes and serves Claude Code session history via REST API
- **iOS app** (`ClaudeHistorySearch/`): SwiftUI client that connects to the server via Bonjour discovery

## Development Commands

### Server (Node.js)
```bash
cd server
npm install        # Install dependencies
npm start          # Start server on port 3847
npm run dev        # Start with auto-reload (--watch)
```

### iOS App
Open `ClaudeHistorySearch.xcodeproj` in Xcode and build/run.

## Architecture

### Server Components

- **`src/index.js`**: Express app entry point, Bonjour advertisement, file watcher setup
- **`src/database.js`**: SQLite (better-sqlite3) setup with FTS5 for full-text search
- **`src/indexer.js`**: Parses Claude session JSONL files from `~/.claude/projects/`
- **`src/routes.js`**: REST API endpoints (`/health`, `/sessions`, `/search`, `/reindex`)

Data flow: JSONL files → indexer → SQLite FTS5 → REST API

### iOS Components

- **`Services/ServerDiscovery.swift`**: Bonjour/NWBrowser for automatic server discovery
- **`Services/APIClient.swift`**: HTTP client for server REST API
- **`Views/`**: SwiftUI views for session list, detail, and message display

### Key Details

- Server runs on port **3847** and advertises via Bonjour as `_claudehistory._tcp`
- Database stored at `~/.claude-history-server/search.db`
- Indexes Claude sessions from `~/.claude/projects/**/*.jsonl`
- Uses SQLite FTS5 with porter stemmer for search
- iOS app auto-discovers server via Bonjour, falls back to `localhost:3847`

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List sessions (pagination via `limit`, `offset`) |
| `/sessions/:id` | GET | Get full conversation |
| `/search?q=term` | GET | Full-text search |
| `/reindex` | POST | Trigger reindex (`force=true` to reindex all) |
