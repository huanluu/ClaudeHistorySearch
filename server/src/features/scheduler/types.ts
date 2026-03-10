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
 * Interface for external command execution (allows mocking in tests).
 * Only covers execSync for az CLI queries — CLI runtime spawning is
 * handled by the CliRuntime abstraction.
 */
export interface CommandExecutor {
  execSync: (command: string, options?: object) => string;
}

