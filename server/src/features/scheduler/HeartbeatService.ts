import { join } from 'path';
import { getConfigDir } from '../../shared/provider/index';
import type { Logger, CliRuntime, HeartbeatRepository, HeartbeatStateRecord, FileSystem } from '../../shared/provider/index';
import type { HeartbeatConfig, HeartbeatTask, HeartbeatResult, WorkItem, ChangeSet, CommandExecutor } from './types';
import { checkForChanges, buildWorkItemPrompt } from './workItems';
import { parseHeartbeatConfig, parseHeartbeatContent } from './heartbeatParser';

/** Reads HEARTBEAT.md and executes enabled tasks on a schedule. */
export class HeartbeatService {
  /** Maximum number of Claude sessions to spawn per heartbeat run */
  static readonly MAX_SESSIONS_PER_HEARTBEAT = 3;

  private config: HeartbeatConfig;
  private configDir: string;
  private fs: FileSystem;
  private executor: CommandExecutor;
  private runtime: CliRuntime | null;
  private repo: HeartbeatRepository | null;
  private logger: Logger;
  private envOverrides: Partial<HeartbeatConfig>;
  // In-memory fallback for tracking processed items (used when no repo is provided)
  private processedState: Map<string, string> = new Map();
  // Lock to prevent overlapping heartbeat runs
  private isRunning = false;
  // Scheduler state
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunCount = 0;
  private initialDelayTimer: NodeJS.Timeout | null = null;

  constructor(fs: FileSystem, executor: CommandExecutor, configDir: string | undefined, repo: HeartbeatRepository | undefined, logger: Logger, runtime?: CliRuntime, envOverrides?: Partial<HeartbeatConfig>) {
    this.fs = fs;
    this.configDir = configDir || getConfigDir();
    this.executor = executor;
    this.runtime = runtime ?? null;
    this.repo = repo ?? null;
    this.logger = logger;
    this.envOverrides = envOverrides ?? {};
    this.config = this.loadConfig();
  }

  /**
   * Get the current configuration
   */
  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime (hot reload).
   * Merges partial values into the current config.
   */
  updateConfig(partial: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Start the heartbeat scheduler. Runs one heartbeat after a short delay,
   * then repeats at the configured interval. Automatically stops any
   * previously running scheduler first (safe for config hot-reload).
   */
  startScheduler(): void {
    this.stopScheduler();

    const config = this.getConfig();
    if (!config.enabled) {
      this.logger.log({ msg: 'Heartbeat rescheduled: disabled', op: 'heartbeat.config' });
      return;
    }

    const runHeartbeatOnce = async (label: string): Promise<void> => {
      this.schedulerRunCount++;
      this.logger.log({
        msg: `${label} (run ${this.schedulerRunCount}${config.maxRuns > 0 ? `/${config.maxRuns}` : ''})...`,
        op: 'heartbeat.run',
        context: { run: this.schedulerRunCount, maxRuns: config.maxRuns },
      });
      try {
        const heartbeatResult = await this.runHeartbeat();
        if (heartbeatResult.sessionsCreated > 0) {
          this.logger.log({ msg: `Heartbeat: ${heartbeatResult.sessionsCreated} sessions created`, op: 'heartbeat.run', context: { sessionsCreated: heartbeatResult.sessionsCreated } });
        } else {
          this.logger.log({ msg: 'Heartbeat: no changes detected', op: 'heartbeat.run' });
        }
        if (heartbeatResult.errors.length > 0) {
          this.logger.error({ msg: `Heartbeat errors: ${heartbeatResult.errors.join(', ')}`, op: 'heartbeat.error', context: { errors: heartbeatResult.errors } });
        }
      } catch (error) {
        this.logger.error({ msg: `Heartbeat error: ${(error as Error).message}`, op: 'heartbeat.error', err: error });
      }

      // Stop scheduling if maxRuns reached
      if (config.maxRuns > 0 && this.schedulerRunCount >= config.maxRuns) {
        this.logger.log({ msg: `Heartbeat: maxRuns (${config.maxRuns}) reached, stopping scheduled heartbeats`, op: 'heartbeat.config', context: { maxRuns: config.maxRuns } });
        if (this.schedulerTimer) {
          clearInterval(this.schedulerTimer);
          this.schedulerTimer = null;
        }
      }
    };

    // Run heartbeat periodically
    this.schedulerTimer = setInterval(() => {
      if (config.maxRuns > 0 && this.schedulerRunCount >= config.maxRuns) {
        return; // Guard against race with clearInterval
      }
      runHeartbeatOnce('Running heartbeat');
    }, config.intervalMs);

    // Run once on startup (delayed to let indexer initialize)
    this.initialDelayTimer = setTimeout(() => {
      this.initialDelayTimer = null;
      runHeartbeatOnce('Running initial heartbeat');
    }, 5000);

    this.logger.log({ msg: `Heartbeat rescheduled every ${config.intervalMs / 1000 / 60} minutes`, op: 'heartbeat.config', context: { intervalMs: config.intervalMs } });
    if (config.maxRuns > 0) {
      this.logger.log({ msg: `Heartbeat max runs: ${config.maxRuns}`, op: 'heartbeat.config', context: { maxRuns: config.maxRuns } });
    }
  }

  /**
   * Whether the scheduler timer is currently running.
   */
  isSchedulerActive(): boolean {
    return this.schedulerTimer !== null;
  }

  /**
   * Stop the heartbeat scheduler, clearing both the interval and any
   * pending initial-delay timer.
   */
  stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    if (this.initialDelayTimer) {
      clearTimeout(this.initialDelayTimer);
      this.initialDelayTimer = null;
    }
    this.schedulerRunCount = 0;
  }

  private loadConfig(): HeartbeatConfig {
    const configPath = join(this.configDir, 'config.json');
    let fileConfig: Record<string, unknown> | null = null;
    if (this.fs.exists(configPath)) {
      try {
        fileConfig = JSON.parse(this.fs.readFile(configPath)) as Record<string, unknown>;
      } catch (error) {
        this.logger.warn({ msg: `Could not parse config.json: ${(error as Error).message}`, op: 'heartbeat.config', err: error });
      }
    }
    return parseHeartbeatConfig(fileConfig, this.envOverrides);
  }

  parseHeartbeatFile(): HeartbeatTask[] {
    const heartbeatPath = join(this.configDir, 'HEARTBEAT.md');
    if (!this.fs.exists(heartbeatPath)) return [];
    return parseHeartbeatContent(this.fs.readFile(heartbeatPath));
  }

  /**
   * Record that a work item has been processed
   */
  recordProcessedItem(key: string, lastChanged: string): void {
    if (this.repo) {
      this.repo.upsertState(key, lastChanged, Date.now());
    } else {
      this.processedState.set(key, lastChanged);
    }
  }

  /**
   * Get the last known changed date for a work item
   */
  getProcessedItemState(key: string): string | undefined {
    if (this.repo) {
      return this.repo.getState(key)?.last_changed ?? undefined;
    }
    return this.processedState.get(key);
  }

  /**
   * Get all heartbeat state records (for status endpoint)
   */
  getAllState(): HeartbeatStateRecord[] {
    if (this.repo) {
      return this.repo.getAllState();
    }
    return [];
  }

  /**
   * Check for new or updated work items
   */
  async checkForChanges(): Promise<ChangeSet> {
    return checkForChanges(this.executor, (key) => this.getProcessedItemState(key));
  }

  /**
   * Spawn a CLI runtime to analyze a work item (fire-and-forget).
   * Returns the session ID from the runtime's headless output.
   * The spawned process continues running in the background.
   */
  async runClaudeAnalysis(workItem: WorkItem): Promise<string | null> {
    if (!this.runtime) {
      throw new Error('No CLI runtime configured for HeartbeatService');
    }

    const prompt = buildWorkItemPrompt(workItem);
    const result = await this.runtime.runHeadless(
      { prompt, workingDir: this.config.workingDirectory },
      this.logger,
    );
    return result.sessionId;
  }

  /**
   * Run the heartbeat - check for changes and spawn Claude sessions
   */
  async runHeartbeat(force?: boolean): Promise<HeartbeatResult> {
    const result: HeartbeatResult = {
      tasksProcessed: 0,
      sessionsCreated: 0,
      sessionIds: [],
      errors: []
    };

    if (!force && !this.config.enabled) {
      return result;
    }

    if (this.isRunning) {
      result.errors.push('Heartbeat already in progress, skipping');
      return result;
    }

    this.isRunning = true;
    try {
      return await this._runHeartbeatInner(result);
    } finally {
      this.isRunning = false;
    }
  }

  private async _runHeartbeatInner(result: HeartbeatResult): Promise<HeartbeatResult> {

    const tasks = this.parseHeartbeatFile();
    result.tasksProcessed = tasks.length;

    // Check if any task enables work items
    const hasWorkItemsTask = tasks.some(t =>
      t.section === 'Work Items' ||
      t.description.toLowerCase().includes('work item')
    );

    if (hasWorkItemsTask) {
      try {
        const changes = await this.checkForChanges();
        result.errors.push(...changes.errors);

        // Process new and updated items (limited by maxItems if set)
        let allItems = [...changes.newItems, ...changes.updatedItems];
        if (this.config.maxItems > 0) {
          allItems = allItems.slice(0, this.config.maxItems);
        }

        for (const item of allItems) {
          if (result.sessionsCreated >= HeartbeatService.MAX_SESSIONS_PER_HEARTBEAT) {
            this.logger.log({
              msg: `Heartbeat session limit reached (${HeartbeatService.MAX_SESSIONS_PER_HEARTBEAT}), deferring ${allItems.length - allItems.indexOf(item)} remaining items to next run`,
              op: 'heartbeat.run',
              context: { limit: HeartbeatService.MAX_SESSIONS_PER_HEARTBEAT, deferred: allItems.length - allItems.indexOf(item) },
            });
            break;
          }
          try {
            const sessionId = await this.runClaudeAnalysis(item);
            // Record as processed
            this.recordProcessedItem(
              `workitem:${item.id}`,
              item.fields['System.ChangedDate']
            );
            result.sessionsCreated++;
            if (sessionId) {
              result.sessionIds.push(sessionId);
            }
          } catch (error) {
            result.errors.push(`Failed to analyze work item ${item.id}: ${(error as Error).message}`);
          }
        }
      } catch (error) {
        result.errors.push(`Heartbeat failed: ${(error as Error).message}`);
      }
    }

    return result;
  }
}
