import { randomUUID } from 'crypto';
import { Cron } from 'croner';
import type { CronJobRecord, CronRepository, CronToolService } from '../../shared/provider/index';
import type { Logger } from '../../shared/provider/index';

/** Maximum concurrent job executions per tick */
const MAX_CONCURRENT_PER_TICK = 3;

/** Auto-disable job after this many consecutive errors */
const MAX_CONSECUTIVE_ERRORS = 5;

/** Tick interval in milliseconds (how often we check for due jobs) */
const TICK_INTERVAL_MS = 60_000;

type RunFn = (opts: { prompt: string; workingDir: string }) => Promise<{ sessionId: string | null }>;

/**
 * Manages scheduled cron jobs: CRUD, scheduling, and execution.
 * Effectless — all I/O delegated to injected `repo` and `runFn`.
 */
export class CronService implements CronToolService {
  private tickTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(
    private readonly repo: CronRepository,
    private readonly runFn: RunFn,
    private readonly logger: Logger,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────

  addJob(opts: { name: string; schedule: { kind: string; value: string; timezone?: string }; prompt: string; workingDir: string }): CronJobRecord {
    if (!opts.prompt.trim()) throw new Error('Prompt cannot be empty');
    if (!opts.workingDir.trim()) throw new Error('Working directory cannot be empty');

    const kind = opts.schedule.kind;
    if (kind !== 'at' && kind !== 'every' && kind !== 'cron') {
      throw new Error(`Unsupported schedule kind: ${kind}. Supported: 'at', 'every', 'cron'`);
    }

    const tz = opts.schedule.timezone ?? null;
    const now = Date.now();
    const record: CronJobRecord = {
      id: randomUUID(),
      name: opts.name,
      enabled: 1,
      schedule_kind: kind,
      schedule_value: opts.schedule.value,
      schedule_timezone: tz,
      prompt: opts.prompt,
      working_dir: opts.workingDir,
      runtime: 'claude',
      next_run_at_ms: CronService.computeNextRun(kind, opts.schedule.value, now, null, tz),
      last_run_at_ms: null,
      last_run_status: null,
      last_session_id: null,
      consecutive_errors: 0,
      created_at_ms: now,
    };
    this.repo.insert(record);
    this.logger.log({ msg: `Cron job created: ${record.name} (${record.id})`, op: 'cron.add', context: { jobId: record.id } });
    return record;
  }

  listJobs(): CronJobRecord[] {
    return this.repo.getAll();
  }

  getJobStatus(id: string): CronJobRecord {
    const job = this.repo.getById(id);
    if (!job) throw new Error(`Cron job not found: ${id}`);
    return job;
  }

  updateJob(id: string, fields: Partial<CronJobRecord>): CronJobRecord {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error(`Cron job not found: ${id}`);

    // Recalculate nextRunAtMs if schedule changed
    const scheduleChanged = fields.schedule_kind !== undefined || fields.schedule_value !== undefined || fields.schedule_timezone !== undefined;
    if (scheduleChanged) {
      const kind = fields.schedule_kind ?? existing.schedule_kind;
      const value = fields.schedule_value ?? existing.schedule_value;
      const tz = fields.schedule_timezone !== undefined ? fields.schedule_timezone : existing.schedule_timezone;
      fields.next_run_at_ms = CronService.computeNextRun(kind, value, Date.now(), existing.last_run_at_ms, tz);
    }

    this.repo.update(id, fields);
    return this.repo.getById(id)!;
  }

  removeJob(id: string): void {
    const existing = this.repo.getById(id);
    if (!existing) throw new Error(`Cron job not found: ${id}`);
    this.repo.remove(id);
    this.logger.log({ msg: `Cron job removed: ${existing.name} (${id})`, op: 'cron.remove', context: { jobId: id } });
  }

  // ── Execution ───────────────────────────────────────────────────────

  async runJobNow(id: string): Promise<{ sessionId: string | null }> {
    const job = this.repo.getById(id);
    if (!job) throw new Error(`Cron job not found: ${id}`);
    return this.executeJob(job);
  }

  // ── Scheduler ───────────────────────────────────────────────────────

  startScheduler(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.tickTimer = setInterval(() => { void this.tick(); }, TICK_INTERVAL_MS);
    this.logger.log({ msg: `Cron scheduler started (${TICK_INTERVAL_MS / 1000}s tick)`, op: 'cron.scheduler' });
  }

  async stopScheduler(): Promise<void> {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    // Await all in-flight executions
    if (this.inFlight.size > 0) {
      this.logger.log({ msg: `Cron scheduler stopping: awaiting ${this.inFlight.size} in-flight jobs`, op: 'cron.scheduler' });
      await Promise.allSettled([...this.inFlight]);
    }
  }

  isSchedulerActive(): boolean {
    return this.tickTimer !== null;
  }

  /** Check for due jobs and execute them. Called by the scheduler timer. */
  async tick(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = Date.now();
      const dueJobs = this.repo.getDueJobs(now);
      const batch = dueJobs.slice(0, MAX_CONCURRENT_PER_TICK);

      for (const job of batch) {
        const promise = this.executeJob(job).catch((err: unknown) => {
          this.logger.error({
            msg: `Cron job execution failed: ${err instanceof Error ? err.message : String(err)}`,
            op: 'cron.execute',
            context: { jobId: job.id },
          });
        });
        this.inFlight.add(promise);
        void promise.finally(() => this.inFlight.delete(promise));
      }

      // Wait for this batch to complete before allowing next tick
      await Promise.allSettled([...this.inFlight]);
    } finally {
      this.isRunning = false;
    }
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async executeJob(job: CronJobRecord): Promise<{ sessionId: string | null }> {
    const now = Date.now();
    try {
      const taggedPrompt = `[Cron: ${job.name}] ${job.prompt}`;
      const result = await this.runFn({ prompt: taggedPrompt, workingDir: job.working_dir });
      this.repo.update(job.id, {
        last_run_at_ms: now,
        last_run_status: 'success',
        last_session_id: result.sessionId,
        consecutive_errors: 0,
        next_run_at_ms: CronService.computeNextRun(job.schedule_kind, job.schedule_value, now, now, job.schedule_timezone),
        ...(job.schedule_kind === 'at' ? { enabled: 0 } : {}),
      });
      this.logger.log({ msg: `Cron job succeeded: ${job.name}`, op: 'cron.execute', context: { jobId: job.id, sessionId: result.sessionId } });
      return result;
    } catch (err: unknown) {
      const errors = job.consecutive_errors + 1;
      const disabled = errors >= MAX_CONSECUTIVE_ERRORS;
      this.repo.update(job.id, {
        last_run_at_ms: now,
        last_run_status: 'error',
        consecutive_errors: errors,
        next_run_at_ms: disabled ? null : CronService.computeNextRun(job.schedule_kind, job.schedule_value, now, now, job.schedule_timezone),
        ...(disabled ? { enabled: 0 } : {}),
      });
      if (disabled) {
        this.logger.error({ msg: `Cron job disabled after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${job.name}`, op: 'cron.circuit-breaker', context: { jobId: job.id } });
      }
      throw err;
    }
  }

  /** Compute the next run time for a schedule. */
  static computeNextRun(kind: string, value: string, nowMs: number, lastRunMs: number | null, timezone?: string | null): number | null {
    if (kind === 'at') {
      const targetMs = new Date(value).getTime();
      if (isNaN(targetMs)) throw new Error(`Invalid 'at' schedule value: ${value}`);
      return targetMs > nowMs ? targetMs : null; // One-shot, already passed
    }
    if (kind === 'every') {
      const intervalMs = parseInt(value, 10);
      if (isNaN(intervalMs) || intervalMs <= 0) throw new Error(`Invalid 'every' schedule value: ${value}`);
      const base = lastRunMs ?? nowMs;
      return base + intervalMs;
    }
    if (kind === 'cron') {
      const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const cron = new Cron(value, { timezone: tz });
        const next = cron.nextRun(new Date(nowMs));
        if (!next) return null;
        // Workaround for croner year-rollback bug (same as OpenClaw):
        // If nextRun returns a past time, retry from the next second
        if (next.getTime() <= nowMs) {
          const retry = cron.nextRun(new Date(nowMs + 1000));
          return retry ? retry.getTime() : null;
        }
        return next.getTime();
      } catch (err: unknown) {
        throw new Error(`Invalid cron expression '${value}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(`Unsupported schedule kind: ${kind}`);
  }
}
