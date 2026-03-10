import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import type { Logger } from '../../provider/index';

// Re-export record types from provider for backward compatibility
export type {
  SessionRecord, HeartbeatStateRecord, MessageRecord,
  SearchResultRecord, LastIndexedRecord, SortOption,
} from '../../provider/index';

export const DB_PATH = join(homedir(), '.claude-history-server', 'search.db');

/**
 * Creates and initializes the SQLite database with schema and migrations.
 * All I/O happens inside this factory — no import-time side effects.
 */
export function createDatabase(dbPath: string, logger: Logger): DatabaseType {
  if (dbPath !== ':memory:') {
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

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
    logger.log({ msg: 'Added last_activity_at column to sessions table', op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }

  // Create index on last_activity_at (after migration ensures column exists)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC)`);

  // Migration: add title column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN title TEXT`);
    logger.log({ msg: 'Added title column to sessions table', op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }

  // Migration: add is_automatic column for heartbeat sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_automatic INTEGER DEFAULT 0`);
    logger.log({ msg: 'Added is_automatic column to sessions table', op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }

  // Migration: add is_unread column for heartbeat sessions
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_unread INTEGER DEFAULT 0`);
    logger.log({ msg: 'Added is_unread column to sessions table', op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }

  // Migration: add is_hidden column for soft-delete
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_hidden INTEGER DEFAULT 0`);
    logger.log({ msg: 'Added is_hidden column to sessions table', op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }

  // Migration: add source column for multi-agent support
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'claude'`);
    logger.log({ msg: 'Added source column to sessions table', op: 'db.migrate' });
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

  // Create cron_jobs table for scheduled task management
  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      schedule_kind TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      prompt TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'claude',
      next_run_at_ms INTEGER,
      last_run_at_ms INTEGER,
      last_run_status TEXT,
      last_session_id TEXT,
      consecutive_errors INTEGER DEFAULT 0,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at_ms);
  `);

  // Migration: rebuild FTS table if it still uses porter tokenizer.
  // Porter stemmer causes false positives for short/acronym queries (e.g. "pps" matches "ppt").
  const ftsSchema = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'`
  ).get() as { sql: string } | undefined;

  if (ftsSchema?.sql?.includes('porter')) {
    logger.log({ msg: 'Migrating FTS table: removing porter stemmer (rebuilds search index)', op: 'db.migrate' });
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

  return db;
}
