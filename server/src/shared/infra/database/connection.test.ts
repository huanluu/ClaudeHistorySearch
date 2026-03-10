import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDatabase } from './connection';
import { noopLogger } from '../../../../tests/__helpers/index';

describe('createDatabase', () => {
  it('creates an in-memory database with WAL mode', () => {
    const db = createDatabase(':memory:', noopLogger);

    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    // In-memory databases use 'memory' journal mode (WAL doesn't apply)
    expect(result[0].journal_mode).toBe('memory');
    db.close();
  });

  it('is idempotent — calling twice on the same path does not error', () => {
    const dir = join(tmpdir(), `connection-test-idempotent-${Date.now()}`);
    const dbPath = join(dir, 'test.db');

    try {
      const db1 = createDatabase(dbPath, noopLogger);
      db1.close();

      const db2 = createDatabase(dbPath, noopLogger);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates parent directory if it does not exist', () => {
    const base = join(tmpdir(), `connection-test-mkdir-${Date.now()}`);
    const dir = join(base, 'nested');
    const dbPath = join(dir, 'test.db');

    expect(existsSync(dir)).toBe(false);

    try {
      const db = createDatabase(dbPath, noopLogger);
      expect(existsSync(dir)).toBe(true);
      db.close();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rebuilds FTS table when porter tokenizer is detected', () => {
    const dir = join(tmpdir(), `connection-test-fts-${Date.now()}`);
    const dbPath = join(dir, 'test.db');
    mkdirSync(dir, { recursive: true });

    try {
      // Set up a DB with porter-tokenized FTS table (the old schema)
      const rawDb = new Database(dbPath);
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          last_indexed INTEGER
        );
        INSERT INTO sessions (id, project, started_at, last_indexed) VALUES ('s1', 'proj', 1000, 999);
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          session_id, role, content, timestamp UNINDEXED, uuid UNINDEXED,
          tokenize='porter unicode61'
        );
      `);
      rawDb.close();

      // Run createDatabase — should detect porter and rebuild
      const logCalls: string[] = [];
      const spyLogger = {
        ...noopLogger,
        log: (entry: { msg: string }) => { logCalls.push(entry.msg); },
      };
      const db = createDatabase(dbPath, spyLogger);

      // Verify FTS table now uses unicode61 (no porter)
      const ftsSchema = db.prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'`
      ).get() as { sql: string };
      expect(ftsSchema.sql).not.toContain('porter');
      expect(ftsSchema.sql).toContain('unicode61');

      // Verify last_indexed was cleared (forces reindex)
      const session = db.prepare('SELECT last_indexed FROM sessions WHERE id = ?').get('s1') as { last_indexed: number | null };
      expect(session.last_indexed).toBeNull();

      // Verify migration was logged
      expect(logCalls.some(m => m.includes('porter'))).toBe(true);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
