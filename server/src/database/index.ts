import type { Database as DatabaseType } from 'better-sqlite3';
import { SqliteSessionRepository } from './SqliteSessionRepository';
import { SqliteHeartbeatRepository } from './SqliteHeartbeatRepository';
import type { SessionRepository } from './interfaces';
import type { HeartbeatRepository } from './interfaces';

// Types
export type {
  SessionRecord,
  MessageRecord,
  SearchResultRecord,
  SortOption,
  LastIndexedRecord,
  HeartbeatStateRecord,
} from './connection';

export type { SessionRepository, IndexSessionParams, HeartbeatRepository, DatabaseStats } from './interfaces';

// Config
export { DB_PATH, createDatabase } from './connection';

// Factories
export function createSessionRepository(db: DatabaseType): SessionRepository {
  return new SqliteSessionRepository(db);
}

export function createHeartbeatRepository(db: DatabaseType): HeartbeatRepository {
  return new SqliteHeartbeatRepository(db);
}
