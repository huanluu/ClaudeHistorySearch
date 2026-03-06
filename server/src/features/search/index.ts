export { indexAllSessions, indexSessionFile, PROJECTS_DIR, CLAUDE_DIR, detectAutomaticSession } from './indexer';
export type { ParsedSession, IndexAllResult, IndexResult, ParsedMessage } from './indexer';
export { FileWatcher } from './FileWatcher';
export type { IndexFn, WatchFn } from './FileWatcher';
export { registerSearchRoutes } from './routes';
export type { SearchRouteDeps } from './routes';
