export { HeartbeatService, getConfigDir } from './HeartbeatService';
export type {
  HeartbeatConfig,
  HeartbeatTask,
  HeartbeatResult,
  WorkItem,
  ChangeSet,
  CommandExecutor,
} from './HeartbeatService';

export { ConfigService } from './ConfigService';
export { FileWatcher } from './FileWatcher';
export { DiagnosticsService } from './DiagnosticsService';
export type { DiagnosticsSources, HealthResult, DiagnosticsResult } from './DiagnosticsService';

export { indexAllSessions, indexSessionFile, PROJECTS_DIR, CLAUDE_DIR } from './indexer';
export type { ParsedSession, IndexAllResult } from './indexer';
