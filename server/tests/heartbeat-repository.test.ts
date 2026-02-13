import Database from 'better-sqlite3';
import { SqliteHeartbeatRepository } from '../src/database/SqliteHeartbeatRepository.js';

describe('SqliteHeartbeatRepository', () => {
  let db: Database.Database;
  let repo: SqliteHeartbeatRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE heartbeat_state (
        key TEXT PRIMARY KEY,
        last_changed TEXT,
        last_processed INTEGER
      );
    `);
    repo = new SqliteHeartbeatRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('getState returns undefined for unknown key', () => {
    expect(repo.getState('nonexistent')).toBeUndefined();
  });

  it('upsertState + getState roundtrip', () => {
    const now = Date.now();
    repo.upsertState('workitem:123', '2024-01-15T10:00:00Z', now);

    const state = repo.getState('workitem:123');
    expect(state).toBeDefined();
    expect(state!.key).toBe('workitem:123');
    expect(state!.last_changed).toBe('2024-01-15T10:00:00Z');
    expect(state!.last_processed).toBe(now);
  });

  it('upsertState updates existing record (INSERT OR REPLACE)', () => {
    const t1 = Date.now();
    const t2 = t1 + 1000;

    repo.upsertState('workitem:456', '2024-01-15T10:00:00Z', t1);
    repo.upsertState('workitem:456', '2024-01-16T12:00:00Z', t2);

    const state = repo.getState('workitem:456');
    expect(state!.last_changed).toBe('2024-01-16T12:00:00Z');
    expect(state!.last_processed).toBe(t2);
  });

  it('getAllState returns all records', () => {
    const now = Date.now();
    repo.upsertState('workitem:1', 'date-a', now);
    repo.upsertState('workitem:2', 'date-b', now + 1);
    repo.upsertState('workitem:3', 'date-c', now + 2);

    const all = repo.getAllState();
    expect(all).toHaveLength(3);
    const keys = all.map(s => s.key).sort();
    expect(keys).toEqual(['workitem:1', 'workitem:2', 'workitem:3']);
  });

  it('getAllState returns empty array when table is empty', () => {
    expect(repo.getAllState()).toEqual([]);
  });
});
