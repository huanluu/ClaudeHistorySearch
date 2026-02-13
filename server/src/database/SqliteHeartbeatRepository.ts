import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import type { HeartbeatStateRecord } from './connection.js';
import type { HeartbeatRepository } from './interfaces.js';

export class SqliteHeartbeatRepository implements HeartbeatRepository {
  private readonly stmts: {
    getState: Statement<unknown[], HeartbeatStateRecord>;
    upsertState: Statement;
    getAllState: Statement<unknown[], HeartbeatStateRecord>;
  };

  constructor(db: DatabaseType) {
    this.stmts = {
      getState: db.prepare(`SELECT * FROM heartbeat_state WHERE key = ?`),
      upsertState: db.prepare(`
        INSERT OR REPLACE INTO heartbeat_state (key, last_changed, last_processed)
        VALUES (?, ?, ?)
      `),
      getAllState: db.prepare(`SELECT * FROM heartbeat_state`),
    };
  }

  getState(key: string): HeartbeatStateRecord | undefined {
    return this.stmts.getState.get(key);
  }

  upsertState(key: string, lastChanged: string, lastProcessed: number): void {
    this.stmts.upsertState.run(key, lastChanged, lastProcessed);
  }

  getAllState(): HeartbeatStateRecord[] {
    return this.stmts.getAllState.all();
  }
}
