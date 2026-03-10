import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronService } from './CronService';
import type { CronJobRecord, CronRepository } from '../../shared/provider/index';
import type { Logger } from '../../shared/provider/index';

function makeMockRepo(): CronRepository & { _store: Map<string, CronJobRecord> } {
  const store = new Map<string, CronJobRecord>();
  return {
    _store: store,
    getAll: () => [...store.values()],
    getById: (id) => store.get(id),
    getDueJobs: (nowMs) => [...store.values()].filter(j => j.enabled === 1 && j.next_run_at_ms !== null && j.next_run_at_ms! <= nowMs),
    insert: (record) => { store.set(record.id, { ...record }); },
    update: (id, fields) => {
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...fields });
    },
    remove: (id) => { store.delete(id); },
  };
}

function makeMockLogger(): Logger {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

describe('CronService', () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let logger: Logger;
  let runFn: ReturnType<typeof vi.fn>;
  let service: CronService;

  beforeEach(() => {
    repo = makeMockRepo();
    logger = makeMockLogger();
    runFn = vi.fn().mockResolvedValue({ sessionId: 'sess-1' });
    service = new CronService(repo, runFn as (opts: { prompt: string; workingDir: string }) => Promise<{ sessionId: string | null }>, logger);
  });

  // ── computeNextRun ──────────────────────────────────────────────────

  describe('computeNextRun', () => {
    it('returns epoch ms for future "at" schedule', () => {
      const future = new Date(Date.now() + 100_000).toISOString();
      const result = CronService.computeNextRun('at', future, Date.now(), null);
      expect(result).toBe(new Date(future).getTime());
    });

    it('returns null for past "at" schedule', () => {
      const past = new Date(Date.now() - 100_000).toISOString();
      const result = CronService.computeNextRun('at', past, Date.now(), null);
      expect(result).toBeNull();
    });

    it('returns base + interval for "every" schedule with no last run', () => {
      const now = 1000;
      const result = CronService.computeNextRun('every', '3600000', now, null);
      expect(result).toBe(now + 3600000);
    });

    it('returns lastRun + interval for "every" schedule with last run', () => {
      const result = CronService.computeNextRun('every', '3600000', 5000, 2000);
      expect(result).toBe(2000 + 3600000);
    });

    it('returns future timestamp for valid cron expression', () => {
      const now = Date.now();
      const result = CronService.computeNextRun('cron', '0 8 * * *', now, null, 'UTC');
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThan(now);
    });

    it('respects timezone for cron expression', () => {
      const now = Date.now();
      const utcResult = CronService.computeNextRun('cron', '0 8 * * *', now, null, 'UTC');
      const tokyoResult = CronService.computeNextRun('cron', '0 8 * * *', now, null, 'Asia/Tokyo');
      // Different timezones should produce different next-run times
      expect(utcResult).not.toBe(tokyoResult);
    });

    it('throws for invalid cron expression', () => {
      expect(() => CronService.computeNextRun('cron', 'not valid', 0, null, 'UTC'))
        .toThrow("Invalid cron expression");
    });

    it('throws for unsupported schedule kind', () => {
      expect(() => CronService.computeNextRun('bogus', '* * * * *', 0, null))
        .toThrow('Unsupported schedule kind: bogus');
    });

    it('throws for invalid "at" value', () => {
      expect(() => CronService.computeNextRun('at', 'not-a-date', 0, null))
        .toThrow("Invalid 'at' schedule value");
    });

    it('throws for invalid "every" value', () => {
      expect(() => CronService.computeNextRun('every', 'abc', 0, null))
        .toThrow("Invalid 'every' schedule value");
    });
  });

  // ── addJob ──────────────────────────────────────────────────────────

  describe('addJob', () => {
    it('creates a job with UUID and computes nextRunAtMs', () => {
      const job = service.addJob({
        name: 'Test',
        schedule: { kind: 'every', value: '60000' },
        prompt: 'Do stuff',
        workingDir: '/tmp',
      });
      expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(job.name).toBe('Test');
      expect(job.enabled).toBe(1);
      expect(job.next_run_at_ms).toBeGreaterThan(Date.now() - 1000);
      expect(repo.getById(job.id)).toBeDefined();
    });

    it('rejects empty prompt', () => {
      expect(() => service.addJob({ name: 'X', schedule: { kind: 'every', value: '1000' }, prompt: '  ', workingDir: '/tmp' }))
        .toThrow('Prompt cannot be empty');
    });

    it('rejects empty workingDir', () => {
      expect(() => service.addJob({ name: 'X', schedule: { kind: 'every', value: '1000' }, prompt: 'Do', workingDir: '' }))
        .toThrow('Working directory cannot be empty');
    });

    it('accepts cron expression schedule', () => {
      const job = service.addJob({
        name: 'Daily',
        schedule: { kind: 'cron', value: '0 8 * * *', timezone: 'UTC' },
        prompt: 'Good morning',
        workingDir: '/tmp',
      });
      expect(job.schedule_kind).toBe('cron');
      expect(job.schedule_timezone).toBe('UTC');
      expect(job.next_run_at_ms).toBeGreaterThan(Date.now() - 1000);
    });

    it('rejects unsupported schedule kind', () => {
      expect(() => service.addJob({ name: 'X', schedule: { kind: 'bogus', value: '* * *' }, prompt: 'Do', workingDir: '/tmp' }))
        .toThrow("Unsupported schedule kind: bogus");
    });
  });

  // ── listJobs / getJobStatus ─────────────────────────────────────────

  describe('listJobs', () => {
    it('returns all jobs', () => {
      service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'a', workingDir: '/tmp' });
      service.addJob({ name: 'B', schedule: { kind: 'every', value: '2000' }, prompt: 'b', workingDir: '/tmp' });
      expect(service.listJobs()).toHaveLength(2);
    });
  });

  describe('getJobStatus', () => {
    it('returns job by id', () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'a', workingDir: '/tmp' });
      expect(service.getJobStatus(job.id).name).toBe('A');
    });

    it('throws for nonexistent id', () => {
      expect(() => service.getJobStatus('nope')).toThrow('Cron job not found');
    });
  });

  // ── updateJob / removeJob ───────────────────────────────────────────

  describe('updateJob', () => {
    it('updates fields and returns updated job', () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'a', workingDir: '/tmp' });
      const updated = service.updateJob(job.id, { name: 'B' });
      expect(updated.name).toBe('B');
    });

    it('recalculates nextRunAtMs when schedule changes', () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'a', workingDir: '/tmp' });
      const original = job.next_run_at_ms;
      const updated = service.updateJob(job.id, { schedule_value: '5000' });
      expect(updated.next_run_at_ms).not.toBe(original);
    });

    it('throws for nonexistent id', () => {
      expect(() => service.updateJob('nope', { name: 'X' })).toThrow('Cron job not found');
    });
  });

  describe('removeJob', () => {
    it('removes the job', () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'a', workingDir: '/tmp' });
      service.removeJob(job.id);
      expect(service.listJobs()).toHaveLength(0);
    });

    it('throws for nonexistent id', () => {
      expect(() => service.removeJob('nope')).toThrow('Cron job not found');
    });
  });

  // ── runJobNow ───────────────────────────────────────────────────────

  describe('runJobNow', () => {
    it('calls runFn and updates job state on success', async () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '60000' }, prompt: 'Do it', workingDir: '/work' });
      const result = await service.runJobNow(job.id);
      expect(result.sessionId).toBe('sess-1');
      expect(runFn).toHaveBeenCalledWith({ prompt: '[Cron: A] Do it', workingDir: '/work' });
      const updated = service.getJobStatus(job.id);
      expect(updated.last_run_status).toBe('success');
      expect(updated.last_session_id).toBe('sess-1');
      expect(updated.consecutive_errors).toBe(0);
    });

    it('increments consecutive_errors on failure', async () => {
      runFn.mockRejectedValue(new Error('boom'));
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '60000' }, prompt: 'x', workingDir: '/tmp' });
      await expect(service.runJobNow(job.id)).rejects.toThrow('boom');
      const updated = service.getJobStatus(job.id);
      expect(updated.last_run_status).toBe('error');
      expect(updated.consecutive_errors).toBe(1);
    });

    it('disables job after 5 consecutive errors (circuit breaker)', async () => {
      runFn.mockRejectedValue(new Error('fail'));
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '60000' }, prompt: 'x', workingDir: '/tmp' });
      // Manually set consecutive_errors to 4
      repo.update(job.id, { consecutive_errors: 4 });

      await expect(service.runJobNow(job.id)).rejects.toThrow('fail');
      const updated = service.getJobStatus(job.id);
      expect(updated.enabled).toBe(0);
      expect(updated.consecutive_errors).toBe(5);
    });

    it('disables one-shot "at" jobs after successful execution', async () => {
      const future = new Date(Date.now() + 100_000).toISOString();
      const job = service.addJob({ name: 'Once', schedule: { kind: 'at', value: future }, prompt: 'Do once', workingDir: '/tmp' });
      await service.runJobNow(job.id);
      const updated = service.getJobStatus(job.id);
      expect(updated.enabled).toBe(0);
    });

    it('throws for nonexistent id', async () => {
      await expect(service.runJobNow('nope')).rejects.toThrow('Cron job not found');
    });
  });

  // ── tick ─────────────────────────────────────────────────────────────

  describe('tick', () => {
    it('executes due jobs', async () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'x', workingDir: '/tmp' });
      // Make the job due by setting next_run_at_ms to past
      repo.update(job.id, { next_run_at_ms: 1 });

      await service.tick();
      expect(runFn).toHaveBeenCalledOnce();
    });

    it('limits concurrent executions to 3 per tick', async () => {
      for (let i = 0; i < 5; i++) {
        const job = service.addJob({ name: `Job ${i}`, schedule: { kind: 'every', value: '1000' }, prompt: 'x', workingDir: '/tmp' });
        repo.update(job.id, { next_run_at_ms: 1 });
      }

      await service.tick();
      expect(runFn).toHaveBeenCalledTimes(3);
    });

    it('does not run when already running (concurrency lock)', async () => {
      const job = service.addJob({ name: 'A', schedule: { kind: 'every', value: '1000' }, prompt: 'x', workingDir: '/tmp' });
      repo.update(job.id, { next_run_at_ms: 1 });

      // Start a slow execution
      let resolveRun!: () => void;
      runFn.mockReturnValue(new Promise(r => { resolveRun = () => r({ sessionId: 's1' }); }));

      const tick1 = service.tick();
      const tick2 = service.tick(); // Should be blocked

      resolveRun();
      await tick1;
      await tick2;

      expect(runFn).toHaveBeenCalledOnce(); // Only first tick ran
    });
  });

  // ── scheduler lifecycle ─────────────────────────────────────────────

  describe('scheduler', () => {
    it('startScheduler sets active state', () => {
      service.startScheduler();
      expect(service.isSchedulerActive()).toBe(true);
      void service.stopScheduler();
    });

    it('stopScheduler clears timer', async () => {
      service.startScheduler();
      await service.stopScheduler();
      expect(service.isSchedulerActive()).toBe(false);
    });
  });
});
