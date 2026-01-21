import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';

const DATA_DIR = join(homedir(), '.claude-history-server');
const DB_PATH = join(DATA_DIR, 'search.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    message_count INTEGER DEFAULT 0,
    preview TEXT,
    last_indexed INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
  CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
`);

// Create FTS5 virtual table for full-text search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    session_id,
    role,
    content,
    timestamp UNINDEXED,
    uuid UNINDEXED,
    tokenize='porter unicode61'
  );
`);

// Prepared statements for common operations
const insertSession = db.prepare(`
  INSERT OR REPLACE INTO sessions (id, project, started_at, message_count, preview, last_indexed)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertMessage = db.prepare(`
  INSERT INTO messages_fts (session_id, role, content, timestamp, uuid)
  VALUES (?, ?, ?, ?, ?)
`);

const getSessionById = db.prepare(`
  SELECT * FROM sessions WHERE id = ?
`);

const getRecentSessions = db.prepare(`
  SELECT * FROM sessions
  ORDER BY started_at DESC
  LIMIT ? OFFSET ?
`);

const searchMessages = db.prepare(`
  SELECT
    messages_fts.session_id,
    messages_fts.role,
    messages_fts.content,
    messages_fts.timestamp,
    messages_fts.uuid,
    sessions.project,
    sessions.started_at,
    highlight(messages_fts, 2, '<mark>', '</mark>') as highlighted_content,
    bm25(messages_fts) as rank
  FROM messages_fts
  JOIN sessions ON sessions.id = messages_fts.session_id
  WHERE messages_fts MATCH ?
  ORDER BY rank
  LIMIT ? OFFSET ?
`);

const getMessagesBySessionId = db.prepare(`
  SELECT session_id, role, content, timestamp, uuid
  FROM messages_fts
  WHERE session_id = ?
  ORDER BY timestamp ASC
`);

const clearSessionMessages = db.prepare(`
  DELETE FROM messages_fts WHERE session_id = ?
`);

const getSessionLastIndexed = db.prepare(`
  SELECT last_indexed FROM sessions WHERE id = ?
`);

export {
  db,
  insertSession,
  insertMessage,
  getSessionById,
  getRecentSessions,
  searchMessages,
  getMessagesBySessionId,
  clearSessionMessages,
  getSessionLastIndexed,
  DB_PATH
};
