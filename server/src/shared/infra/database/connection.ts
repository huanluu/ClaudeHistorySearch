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
function addColumnIfMissing(db: DatabaseType, table: string, column: string, type: string, logger: Logger): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    logger.log({ msg: `Added ${column} column to ${table} table`, op: 'db.migrate' });
  } catch {
    // Column already exists, ignore
  }
}

function runSessionMigrations(db: DatabaseType, logger: Logger): void {
  addColumnIfMissing(db, 'sessions', 'last_activity_at', 'INTEGER', logger);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_at DESC)`);
  addColumnIfMissing(db, 'sessions', 'title', 'TEXT', logger);
  addColumnIfMissing(db, 'sessions', 'is_automatic', 'INTEGER DEFAULT 0', logger);
  addColumnIfMissing(db, 'sessions', 'is_unread', 'INTEGER DEFAULT 0', logger);
  addColumnIfMissing(db, 'sessions', 'is_hidden', 'INTEGER DEFAULT 0', logger);
  addColumnIfMissing(db, 'sessions', 'source', "TEXT DEFAULT 'claude'", logger);
}

function setupFtsTable(db: DatabaseType, logger: Logger): void {
  // Rebuild FTS table if it still uses porter tokenizer (causes false positives)
  const ftsSchema = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'`
  ).get() as { sql: string } | undefined;

  if (ftsSchema?.sql?.includes('porter')) {
    logger.log({ msg: 'Migrating FTS table: removing porter stemmer (rebuilds search index)', op: 'db.migrate' });
    db.exec(`DROP TABLE messages_fts`);
    db.exec(`UPDATE sessions SET last_indexed = NULL`);
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      session_id, role, content, timestamp UNINDEXED, uuid UNINDEXED, tokenize='unicode61'
    );
  `);
}

export function createDatabase(dbPath: string, logger: Logger): DatabaseType {
  if (dbPath !== ':memory:') {
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, project TEXT NOT NULL,
      started_at INTEGER NOT NULL, last_activity_at INTEGER,
      message_count INTEGER DEFAULT 0, preview TEXT, title TEXT, last_indexed INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
  `);

  runSessionMigrations(db, logger);

  db.exec(`
    CREATE TABLE IF NOT EXISTS heartbeat_state (
      key TEXT PRIMARY KEY, last_changed TEXT, last_processed INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER DEFAULT 1,
      schedule_kind TEXT NOT NULL, schedule_value TEXT NOT NULL, schedule_timezone TEXT,
      prompt TEXT NOT NULL, working_dir TEXT NOT NULL, runtime TEXT NOT NULL DEFAULT 'claude',
      next_run_at_ms INTEGER, last_run_at_ms INTEGER, last_run_status TEXT,
      last_session_id TEXT, consecutive_errors INTEGER DEFAULT 0, created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at_ms);
  `);
  addColumnIfMissing(db, 'cron_jobs', 'schedule_timezone', 'TEXT', logger);

  setupFtsTable(db, logger);

  return db;
}
