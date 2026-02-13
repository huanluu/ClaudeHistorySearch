import Database, { type Statement, type Database as DatabaseType } from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { logger } from '../logger.js';

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
  is_hidden: number;
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

// Migration: add is_hidden column for soft-delete
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN is_hidden INTEGER DEFAULT 0`);
  logger.log('Added is_hidden column to sessions table');
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

// Migration: rebuild FTS table if it still uses porter tokenizer.
// Porter stemmer causes false positives for short/acronym queries (e.g. "pps" matches "ppt").
const ftsSchema = db.prepare(
  `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'`
).get() as { sql: string } | undefined;

if (ftsSchema?.sql?.includes('porter')) {
  logger.log('Migrating FTS table: removing porter stemmer (rebuilds search index)');
  db.exec(`DROP TABLE messages_fts`);
  // Force reindex by clearing last_indexed timestamps
  db.exec(`UPDATE sessions SET last_indexed = NULL`);
}

// Create FTS5 virtual table for full-text search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    session_id,
    role,
    content,
    timestamp UNINDEXED,
    uuid UNINDEXED,
    tokenize='unicode61'
  );
`);

// Heartbeat-related prepared statements (out of scope for SessionRepository)
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
