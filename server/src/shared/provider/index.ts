export { getConfigDir } from './config';
export type {
  SessionRecord, MessageRecord, SearchResultRecord, SortOption, LastIndexedRecord, HeartbeatStateRecord,
  IndexSessionParams, SessionRepository, DatabaseStats, HeartbeatRepository,
} from './types';
export { authMiddleware } from './auth/index';
export { generateApiKey, validateApiKey, hasApiKey, removeApiKey } from './auth/index';
export { WorkingDirValidator } from './security/index';
export type { ValidationResult } from './security/index';
export { createLogger, LOG_PATH, ErrorRingBuffer } from './logger/index';
export type { Logger, LoggerOptions, CreateLoggerOptions, LogEntry, ErrorType, ErrorEntry } from './logger/index';
export { createRequestLogger } from './logger/index';
export type { RequestLogLevel, RequestLoggerOptions } from './logger/index';
