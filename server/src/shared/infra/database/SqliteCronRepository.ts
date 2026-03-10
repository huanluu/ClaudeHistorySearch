import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import type { CronJobRecord, CronRepository } from '../../provider/index';

export class SqliteCronRepository implements CronRepository {
  private readonly stmts: {
    getAll: Statement<unknown[], CronJobRecord>;
    getById: Statement<unknown[], CronJobRecord>;
    getDueJobs: Statement<unknown[], CronJobRecord>;
    insert: Statement;
    remove: Statement;
  };

  constructor(private readonly db: DatabaseType) {
    this.stmts = {
      getAll: db.prepare('SELECT * FROM cron_jobs ORDER BY created_at_ms DESC'),
      getById: db.prepare('SELECT * FROM cron_jobs WHERE id = ?'),
      getDueJobs: db.prepare(
        'SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run_at_ms IS NOT NULL AND next_run_at_ms <= ?',
      ),
      insert: db.prepare(`
        INSERT INTO cron_jobs (id, name, enabled, schedule_kind, schedule_value, schedule_timezone, prompt, working_dir, runtime, next_run_at_ms, last_run_at_ms, last_run_status, last_session_id, consecutive_errors, created_at_ms)
        VALUES (@id, @name, @enabled, @schedule_kind, @schedule_value, @schedule_timezone, @prompt, @working_dir, @runtime, @next_run_at_ms, @last_run_at_ms, @last_run_status, @last_session_id, @consecutive_errors, @created_at_ms)
      `),
      remove: db.prepare('DELETE FROM cron_jobs WHERE id = ?'),
    };
  }

  getAll(): CronJobRecord[] {
    return this.stmts.getAll.all();
  }

  getById(id: string): CronJobRecord | undefined {
    return this.stmts.getById.get(id);
  }

  getDueJobs(nowMs: number): CronJobRecord[] {
    return this.stmts.getDueJobs.all(nowMs);
  }

  insert(record: CronJobRecord): void {
    this.stmts.insert.run(record);
  }

  private static readonly MUTABLE_COLUMNS = new Set([
    'name', 'enabled', 'schedule_kind', 'schedule_value', 'schedule_timezone', 'prompt', 'working_dir',
    'runtime', 'next_run_at_ms', 'last_run_at_ms', 'last_run_status', 'last_session_id',
    'consecutive_errors',
  ]);

  update(id: string, fields: Partial<CronJobRecord>): void {
    const existing = this.getById(id);
    if (!existing) return;

    const entries = Object.entries(fields).filter(([k]) => SqliteCronRepository.MUTABLE_COLUMNS.has(k));
    if (entries.length === 0) return;

    const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
    const values = entries.map(([, v]) => v);
    this.db.prepare(`UPDATE cron_jobs SET ${setClauses} WHERE id = ?`).run(...values, id);
  }

  remove(id: string): void {
    this.stmts.remove.run(id);
  }
}
