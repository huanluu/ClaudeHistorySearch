import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from './connection';
import { SqliteCronRepository } from './SqliteCronRepository';
import type { CronJobRecord } from '../../provider/index';
import { createLogger } from '../../provider/index';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    name: 'Test Job',
    enabled: 1,
    schedule_kind: 'every',
    schedule_value: '3600000',
    schedule_timezone: null,
    prompt: 'Do something',
    working_dir: '/tmp',
    runtime: 'claude',
    next_run_at_ms: 1000,
    last_run_at_ms: null,
    last_run_status: null,
    last_session_id: null,
    consecutive_errors: 0,
    created_at_ms: Date.now(),
    ...overrides,
  };
}

describe('SqliteCronRepository', () => {
  let repo: SqliteCronRepository;

  beforeEach(() => {
    const logger = createLogger('/dev/null');
    const db = createDatabase(':memory:', logger);
    repo = new SqliteCronRepository(db);
  });

  it('insert and getById round-trip', () => {
    const job = makeJob();
    repo.insert(job);
    const result = repo.getById('job-1');
    expect(result).toEqual(job);
  });

  it('getById returns undefined for nonexistent id', () => {
    expect(repo.getById('nonexistent')).toBeUndefined();
  });

  it('getAll returns all records ordered by created_at_ms desc', () => {
    repo.insert(makeJob({ id: 'a', name: 'First', created_at_ms: 100 }));
    repo.insert(makeJob({ id: 'b', name: 'Second', created_at_ms: 200 }));
    const all = repo.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('b');
    expect(all[1].id).toBe('a');
  });

  it('getDueJobs filters by enabled and next_run_at_ms', () => {
    repo.insert(makeJob({ id: 'due', next_run_at_ms: 500, enabled: 1 }));
    repo.insert(makeJob({ id: 'future', next_run_at_ms: 2000, enabled: 1 }));
    repo.insert(makeJob({ id: 'disabled', next_run_at_ms: 500, enabled: 0 }));
    repo.insert(makeJob({ id: 'no-next', next_run_at_ms: null, enabled: 1 }));

    const due = repo.getDueJobs(1000);
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('due');
  });

  it('update modifies specific fields', () => {
    repo.insert(makeJob());
    repo.update('job-1', { name: 'Updated', last_run_status: 'success' });
    const result = repo.getById('job-1');
    expect(result?.name).toBe('Updated');
    expect(result?.last_run_status).toBe('success');
    expect(result?.prompt).toBe('Do something'); // unchanged
  });

  it('update is a no-op for nonexistent id', () => {
    repo.update('nonexistent', { name: 'Updated' });
    // No throw, no side effects
  });

  it('remove deletes the record', () => {
    repo.insert(makeJob());
    repo.remove('job-1');
    expect(repo.getById('job-1')).toBeUndefined();
  });

  it('remove is a no-op for nonexistent id', () => {
    repo.remove('nonexistent');
    // No throw
  });
});
