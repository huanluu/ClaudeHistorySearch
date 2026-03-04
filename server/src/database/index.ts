import type { Database as DatabaseType } from 'better-sqlite3';
import { db } from './connection';
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
export { DB_PATH } from './connection';

// Factories
export function createSessionRepository(customDb?: DatabaseType): SessionRepository {
  return new SqliteSessionRepository(customDb ?? db);
}

export function createHeartbeatRepository(customDb?: DatabaseType): HeartbeatRepository {
  return new SqliteHeartbeatRepository(customDb ?? db);
}
