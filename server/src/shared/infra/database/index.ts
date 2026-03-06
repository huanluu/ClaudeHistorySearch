import type { Database as DatabaseType } from 'better-sqlite3';
import { SqliteSessionRepository } from './SqliteSessionRepository';
import { SqliteHeartbeatRepository } from './SqliteHeartbeatRepository';
import type { SessionRepository, HeartbeatRepository } from '../../provider/index';

// Re-export domain types (so consumers can import from here during migration)
export type {
  SessionRecord, MessageRecord, SearchResultRecord, SortOption, LastIndexedRecord, HeartbeatStateRecord,
  SessionRepository, IndexSessionParams, HeartbeatRepository, DatabaseStats,
} from '../../provider/index';

// Config
export { DB_PATH, createDatabase } from './connection';

// Factories
export function createSessionRepository(db: DatabaseType): SessionRepository {
  return new SqliteSessionRepository(db);
}

export function createHeartbeatRepository(db: DatabaseType): HeartbeatRepository {
  return new SqliteHeartbeatRepository(db);
}
