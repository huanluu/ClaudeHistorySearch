import type { Database as DatabaseType } from 'better-sqlite3';
import { db } from './connection.js';
import { SqliteSessionRepository } from './SqliteSessionRepository.js';
import { SqliteHeartbeatRepository } from './SqliteHeartbeatRepository.js';
import type { SessionRepository } from './interfaces.js';
import type { HeartbeatRepository } from './interfaces.js';

// Types
export type {
  SessionRecord,
  MessageRecord,
  SearchResultRecord,
  SortOption,
  LastIndexedRecord,
  HeartbeatStateRecord,
} from './connection.js';

export type { SessionRepository, IndexSessionParams, HeartbeatRepository } from './interfaces.js';

// Config
export { DB_PATH } from './connection.js';

// Factories
export function createSessionRepository(customDb?: DatabaseType): SessionRepository {
  return new SqliteSessionRepository(customDb ?? db);
}

export function createHeartbeatRepository(customDb?: DatabaseType): HeartbeatRepository {
  return new SqliteHeartbeatRepository(customDb ?? db);
}
