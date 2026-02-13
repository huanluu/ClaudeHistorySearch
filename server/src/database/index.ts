export type {
  SessionRecord,
  MessageRecord,
  SearchResultRecord,
  SortOption,
  LastIndexedRecord,
  HeartbeatStateRecord,
} from './connection.js';

export { db, DB_PATH, getAllHeartbeatState, getHeartbeatState, upsertHeartbeatState } from './connection.js';

export type { SessionRepository, IndexSessionParams } from './interfaces.js';

export { SqliteSessionRepository } from './SqliteSessionRepository.js';

import { db } from './connection.js';
import { SqliteSessionRepository } from './SqliteSessionRepository.js';
import type { SessionRepository } from './interfaces.js';

export function createSessionRepository(): SessionRepository {
  return new SqliteSessionRepository(db);
}
