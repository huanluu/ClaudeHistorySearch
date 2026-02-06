import Database, { type Statement, type Database as DatabaseType } from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { logger } from './logger.js';

// Types for database records
export interface SessionRecord {
  id: string;
  project: string;
  started_at: number;
  last_activity_at: number | null;
  message_count: number;
  preview: string | null;
  title: string | null;
  last_indexed: number | null;
  is_automatic: number;
  is_unread: number;
}

export interface HeartbeatStateRecord {
  key: string;
  last_changed: string | null;
  last_processed: number | null;
}

export interface MessageRecord {
  session_id: string;
  role: string;
  content: string;
  timestamp: number | null;
  uuid: string;
}

export interface SearchResultRecord extends MessageRecord {
  project: string;
  started_at: number;
  title: string | null;
  highlighted_content: string;
  rank: number;
}

export interface LastIndexedRecord {
  last_indexed: number | null;
}

export type SortOption = 'relevance' | 'date';

const DATA_DIR = join(homedir(), '.claude-history-server');
export const DB_PATH = join(DATA_DIR, 'search.db');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

export const db: DatabaseType = new Database(DB_PATH);

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
  logger.log('Added last_activity_at column to sessions table');
} catch {
  // Column already exists, ignore
}

// Create index on last_activity_at (after migration ensures column exists)
db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC)`);

// Migration: add title column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
  logger.log('Added title column to sessions table');
} catch {
  // Column already exists, ignore
}

// Migration: add is_automatic column for heartbeat sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN is_automatic INTEGER DEFAULT 0`);
  logger.log('Added is_automatic column to sessions table');
} catch {
  // Column already exists, ignore
}

// Migration: add is_unread column for heartbeat sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN is_unread INTEGER DEFAULT 0`);
  logger.log('Added is_unread column to sessions table');
} catch {
  // Column already exists, ignore
}

// Create heartbeat_state table for tracking processed items
db.exec(`
  CREATE TABLE IF NOT EXISTS heartbeat_state (
    key TEXT PRIMARY KEY,
    last_changed TEXT,
    last_processed INTEGER
  );
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

// Prepared statements with proper typing
export const insertSession: Statement = db.prepare(`
  INSERT OR REPLACE INTO sessions (id, project, started_at, last_activity_at, message_count, preview, title, last_indexed, is_automatic, is_unread)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export const insertMessage: Statement = db.prepare(`
  INSERT INTO messages_fts (session_id, role, content, timestamp, uuid)
  VALUES (?, ?, ?, ?, ?)
`);

export const getSessionById: Statement<unknown[], SessionRecord> = db.prepare(`
  SELECT * FROM sessions WHERE id = ?
`);

export const getRecentSessions: Statement<unknown[], SessionRecord> = db.prepare(`
  SELECT * FROM sessions
  ORDER BY COALESCE(last_activity_at, started_at) DESC
  LIMIT ? OFFSET ?
`);

const searchMessagesByRelevance: Statement<unknown[], SearchResultRecord> = db.prepare(`
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

const searchMessagesByDate: Statement<unknown[], SearchResultRecord> = db.prepare(`
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
  ORDER BY sessions.started_at DESC, rank
  LIMIT ? OFFSET ?
`);

// Wrapper function to select the appropriate query based on sort option
export function searchMessages(
  query: string,
  limit: number,
  offset: number,
  sort: SortOption = 'relevance'
): SearchResultRecord[] {
  const stmt = sort === 'date' ? searchMessagesByDate : searchMessagesByRelevance;
  return stmt.all(query, limit, offset);
}

export const getMessagesBySessionId: Statement<unknown[], MessageRecord> = db.prepare(`
  SELECT session_id, role, content, timestamp, uuid
  FROM messages_fts
  WHERE session_id = ?
  ORDER BY timestamp ASC
`);

export const clearSessionMessages: Statement = db.prepare(`
  DELETE FROM messages_fts WHERE session_id = ?
`);

export const getSessionLastIndexed: Statement<unknown[], LastIndexedRecord> = db.prepare(`
  SELECT last_indexed FROM sessions WHERE id = ?
`);

// Re-export for backwards compatibility in tests
export { searchMessagesByRelevance, searchMessagesByDate };

// Heartbeat-related prepared statements
export const markSessionAsRead: Statement = db.prepare(`
  UPDATE sessions SET is_unread = 0 WHERE id = ?
`);

export const getHeartbeatState: Statement<unknown[], HeartbeatStateRecord> = db.prepare(`
  SELECT * FROM heartbeat_state WHERE key = ?
`);

export const upsertHeartbeatState: Statement = db.prepare(`
  INSERT OR REPLACE INTO heartbeat_state (key, last_changed, last_processed)
  VALUES (?, ?, ?)
`);

export const getAllHeartbeatState: Statement<unknown[], HeartbeatStateRecord> = db.prepare(`
  SELECT * FROM heartbeat_state
`);
