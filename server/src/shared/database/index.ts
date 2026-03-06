// Re-export shim — canonical location is shared/infra/database/ and shared/provider/types
// This file exists for backward compatibility during the migration.
export type {
  SessionRecord, MessageRecord, SearchResultRecord, SortOption, LastIndexedRecord, HeartbeatStateRecord,
  SessionRepository, IndexSessionParams, HeartbeatRepository, DatabaseStats,
} from '../provider/types';

export { DB_PATH, createDatabase } from '../infra/database/connection';
export { createSessionRepository, createHeartbeatRepository } from '../infra/database/index';
