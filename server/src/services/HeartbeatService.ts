import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync, spawn, ChildProcess } from 'child_process';
import { logger } from '../logger.js';

/**
 * Configuration for the heartbeat service
 */
export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  workingDirectory: string;
  maxItems: number;  // Maximum work items to process per heartbeat (0 = unlimited)
  maxRuns: number;   // Maximum scheduled heartbeat runs (0 = unlimited)
}

/**
 * A task parsed from HEARTBEAT.md
 */
export interface HeartbeatTask {
  section: string;
  description: string;
  enabled: boolean;
}

/**
 * Result of a heartbeat run
 */
export interface HeartbeatResult {
  tasksProcessed: number;
  sessionsCreated: number;
  sessionIds: string[];
  errors: string[];
}

/**
 * Azure DevOps work item structure (from az boards CLI)
 */
export interface WorkItem {
  id: number;
  fields: {
    'System.Title': string;
    'System.State': string;
    'System.ChangedDate': string;
    'System.AssignedTo'?: {
      uniqueName: string;
    };
    'System.Description'?: string;
    'System.WorkItemType'?: string;
  };
}

/**
 * Result of change detection
 */
export interface ChangeSet {
  newItems: WorkItem[];
  updatedItems: WorkItem[];
  errors: string[];
}

/**
 * Interface for external command execution (allows mocking in tests)
 */
export interface CommandExecutor {
  execSync: (command: string, options?: object) => string;
  spawn: (command: string, args: string[], options: object) => ChildProcess;
}

/**
 * Default command executor using real child_process
 */
const defaultExecutor: CommandExecutor = {
  execSync: (command: string, options?: object) => {
    return execSync(command, { encoding: 'utf-8', ...options }) as string;
  },
  spawn: (command: string, args: string[], options: object) => {
    return spawn(command, args, options);
  }
};

/**
 * Default configuration directory
 */
export function getConfigDir(): string {
  return join(homedir(), '.claude-history-server');
}

/**
 * HeartbeatService reads HEARTBEAT.md and executes enabled tasks periodically.
 *
 * Configuration is loaded from:
 * 1. Default values
 * 2. ~/.claude-history-server/config.json (overrides defaults)
 * 3. Environment variables (overrides config file)
 *
 * HEARTBEAT.md format:
 * ```markdown
 * # HEARTBEAT.md
 *
 * ## Work Items
 * - [x] Enabled task (checked)
 * - [ ] Disabled task (unchecked)
 * ```
 */
export class HeartbeatService {
  /** Maximum number of Claude sessions to spawn per heartbeat run */
  static readonly MAX_SESSIONS_PER_HEARTBEAT = 3;

  private config: HeartbeatConfig;
  private configDir: string;
  private executor: CommandExecutor;
  // In-memory state for tracking processed items (tests use this directly)
  // Production will use the database heartbeat_state table
  private processedState: Map<string, string> = new Map();
  // Lock to prevent overlapping heartbeat runs
  private isRunning = false;

  constructor(configDir?: string, executor?: CommandExecutor) {
    this.configDir = configDir || getConfigDir();
    this.executor = executor || defaultExecutor;
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
   * Load configuration from config.json with environment variable overrides
   */
  private loadConfig(): HeartbeatConfig {
    // Start with defaults
    const config: HeartbeatConfig = {
      enabled: true,
      intervalMs: 3600000, // 1 hour
      workingDirectory: process.cwd(),
      maxItems: 0,  // 0 = unlimited
      maxRuns: 0    // 0 = unlimited
    };

    // Load from config file if it exists
    const configPath = join(this.configDir, 'config.json');
    if (existsSync(configPath)) {
      try {
        const fileContent = readFileSync(configPath, 'utf-8');
        const fileConfig = JSON.parse(fileContent);

        if (fileConfig.heartbeat) {
          if (typeof fileConfig.heartbeat.enabled === 'boolean') {
            config.enabled = fileConfig.heartbeat.enabled;
          }
          if (typeof fileConfig.heartbeat.intervalMs === 'number') {
            config.intervalMs = fileConfig.heartbeat.intervalMs;
          }
          if (typeof fileConfig.heartbeat.workingDirectory === 'string') {
            config.workingDirectory = fileConfig.heartbeat.workingDirectory;
          }
          if (typeof fileConfig.heartbeat.maxItems === 'number') {
            config.maxItems = fileConfig.heartbeat.maxItems;
          }
          if (typeof fileConfig.heartbeat.maxRuns === 'number') {
            config.maxRuns = fileConfig.heartbeat.maxRuns;
          }
        }
      } catch (error) {
        // Malformed config file - use defaults
        logger.warn(`Warning: Could not parse config.json: ${(error as Error).message}`);
      }
    }

    // Environment variable overrides
    if (process.env.HEARTBEAT_ENABLED !== undefined) {
      config.enabled = process.env.HEARTBEAT_ENABLED !== 'false';
    }
    if (process.env.HEARTBEAT_INTERVAL_MS !== undefined) {
      const parsed = parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10);
      if (!isNaN(parsed)) {
        config.intervalMs = parsed;
      }
    }
    if (process.env.HEARTBEAT_WORKING_DIR !== undefined) {
      config.workingDirectory = process.env.HEARTBEAT_WORKING_DIR;
    }
    if (process.env.HEARTBEAT_MAX_ITEMS !== undefined) {
      const parsed = parseInt(process.env.HEARTBEAT_MAX_ITEMS, 10);
      if (!isNaN(parsed)) {
        config.maxItems = parsed;
      }
    }
    if (process.env.HEARTBEAT_MAX_RUNS !== undefined) {
      const parsed = parseInt(process.env.HEARTBEAT_MAX_RUNS, 10);
      if (!isNaN(parsed)) {
        config.maxRuns = parsed;
      }
    }

    return config;
  }

  /**
   * Parse HEARTBEAT.md and return enabled tasks
   */
  parseHeartbeatFile(): HeartbeatTask[] {
    const heartbeatPath = join(this.configDir, 'HEARTBEAT.md');

    if (!existsSync(heartbeatPath)) {
      return [];
    }

    const content = readFileSync(heartbeatPath, 'utf-8');
    if (!content.trim()) {
      return [];
    }

    const tasks: HeartbeatTask[] = [];
    let currentSection = 'Default';

    const lines = content.split('\n');

    for (const line of lines) {
      // Check for section headers (## Section Name)
      const sectionMatch = line.match(/^##\s+(.+)$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        continue;
      }

      // Check for checklist items
      // - [x] Enabled task
      // - [ ] Disabled task
      const checklistMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
      if (checklistMatch) {
        const isChecked = checklistMatch[1].toLowerCase() === 'x';
        const description = checklistMatch[2].trim();

        if (isChecked) {
          tasks.push({
            section: currentSection,
            description,
            enabled: true
          });
        }
      }
    }

    return tasks;
  }

  /**
   * Record that a work item has been processed
   */
  recordProcessedItem(key: string, lastChanged: string): void {
    this.processedState.set(key, lastChanged);
  }

  /**
   * Get the last known changed date for a work item
   */
  getProcessedItemState(key: string): string | undefined {
    return this.processedState.get(key);
  }

  /**
   * Fetch work items from Azure DevOps using az CLI with WIQL query
   */
  private fetchWorkItems(): WorkItem[] {
    try {
      const wiql = "SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate], [System.AssignedTo], [System.Description], [System.WorkItemType] FROM WorkItems WHERE [System.AssignedTo] = @me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' AND [System.State] <> 'Resolved' ORDER BY [System.ChangedDate] DESC";
      const output = this.executor.execSync(
        `az boards query --wiql "${wiql}" -o json`,
        { encoding: 'utf-8' }
      );
      return JSON.parse(output) as WorkItem[];
    } catch (error) {
      throw new Error(`Failed to fetch work items: ${(error as Error).message}`);
    }
  }

  /**
   * Check for new or updated work items
   */
  async checkForChanges(): Promise<ChangeSet> {
    const result: ChangeSet = {
      newItems: [],
      updatedItems: [],
      errors: []
    };

    try {
      const workItems = this.fetchWorkItems();

      for (const item of workItems) {
        const key = `workitem:${item.id}`;
        const changedDate = item.fields['System.ChangedDate'];
        const lastProcessed = this.getProcessedItemState(key);

        if (!lastProcessed) {
          // New item - never processed
          result.newItems.push(item);
        } else if (lastProcessed !== changedDate) {
          // Updated item - changed date differs
          result.updatedItems.push(item);
        }
        // If lastProcessed === changedDate, skip (unchanged)
      }
    } catch (error) {
      result.errors.push((error as Error).message);
    }

    return result;
  }

  /**
   * Build the prompt for Claude analysis
   */
  private buildPrompt(workItem: WorkItem): string {
    return `<!-- HEARTBEAT_SESSION -->
[Heartbeat] Analyze Work Item #${workItem.id}

Work Item Details:
- ID: ${workItem.id}
- Title: ${workItem.fields['System.Title']}
- State: ${workItem.fields['System.State']}
- Type: ${workItem.fields['System.WorkItemType'] || 'Unknown'}

${workItem.fields['System.Description'] ? `Description:\n${workItem.fields['System.Description']}` : ''}

Please analyze this work item in the context of the codebase:
1. Identify relevant code files and modules
2. Assess complexity and effort required
3. Suggest an implementation approach
4. Note any potential risks or dependencies`;
  }

  /**
   * Spawn Claude to analyze a work item (fire-and-forget).
   * Returns the session ID extracted from Claude's stream-json init message.
   * The Claude process continues running in the background.
   */
  async runClaudeAnalysis(workItem: WorkItem): Promise<string | null> {
    const prompt = this.buildPrompt(workItem);

    return new Promise((resolve, reject) => {
      const child = this.executor.spawn(
        'claude',
        ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
        {
          cwd: this.config.workingDirectory,
          env: {
            ...process.env,
            CI: '1',
            TERM: 'dumb',
            NO_COLOR: '1'
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );

      let sessionId: string | null = null;
      let buffer = '';
      let resolved = false;

      // Read stdout to extract session_id from the first init message
      child.stdout?.on('data', (data: Buffer) => {
        if (resolved) return;
        buffer += data.toString();

        // Look for complete JSON lines
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
              sessionId = msg.session_id;
              resolved = true;
              // Unref the child so it doesn't keep the parent alive
              child.unref();
              resolve(sessionId);
              return;
            }
          } catch {
            // Not a complete JSON line yet, keep buffering
          }
        }
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      // If Claude exits before we get a session_id, resolve with null
      child.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });
    });
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
            logger.log(`Heartbeat session limit reached (${HeartbeatService.MAX_SESSIONS_PER_HEARTBEAT}), deferring ${allItems.length - allItems.indexOf(item)} remaining items to next run`);
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
