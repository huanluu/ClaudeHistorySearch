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
    last_activity_at INTEGER,
    message_count INTEGER DEFAULT 0,
    preview TEXT,
    title TEXT,
    last_indexed INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
  CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
`);

// Migration: add last_activity_at column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN last_activity_at INTEGER`);
  console.log('Added last_activity_at column to sessions table');
} catch (e) {
  // Column already exists, ignore
}

// Create index on last_activity_at (after migration ensures column exists)
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC)`);

// Migration: add title column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
  console.log('Added title column to sessions table');
} catch (e) {
  // Column already exists, ignore
}

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
  INSERT OR REPLACE INTO sessions (id, project, started_at, last_activity_at, message_count, preview, title, last_indexed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
  ORDER BY COALESCE(last_activity_at, started_at) DESC
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
    sessions.title,
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
