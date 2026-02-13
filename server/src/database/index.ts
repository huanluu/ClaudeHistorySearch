export type {
  SessionRecord,
  MessageRecord,
  SearchResultRecord,
  SortOption,
  LastIndexedRecord,
  HeartbeatStateRecord,
} from './connection.js';

export { db, DB_PATH } from './connection.js';

export type { SessionRepository, IndexSessionParams, HeartbeatRepository } from './interfaces.js';

export { SqliteSessionRepository } from './SqliteSessionRepository.js';
export { SqliteHeartbeatRepository } from './SqliteHeartbeatRepository.js';

import { db } from './connection.js';
import { SqliteSessionRepository } from './SqliteSessionRepository.js';
import { SqliteHeartbeatRepository } from './SqliteHeartbeatRepository.js';
import type { SessionRepository } from './interfaces.js';
import type { HeartbeatRepository } from './interfaces.js';

export function createSessionRepository(): SessionRepository {
  return new SqliteSessionRepository(db);
}

export function createHeartbeatRepository(): HeartbeatRepository {
  return new SqliteHeartbeatRepository(db);
}
