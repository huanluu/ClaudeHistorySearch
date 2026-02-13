import type { SessionRecord, MessageRecord, SearchResultRecord, SortOption, LastIndexedRecord } from './connection.js';

export interface IndexSessionParams {
  sessionId: string;
  project: string;
  startedAt: number;
  lastActivityAt: number;
  messageCount: number;
  preview: string;
  title: string | null;
  lastIndexed: number;
  isAutomatic: boolean;
  messages: Array<{ role: string; content: string; timestamp: number | null; uuid: string }>;
}

export interface SessionRepository {
  // Read (routes)
  getRecentSessions(limit: number, offset: number): SessionRecord[];
  getManualSessions(limit: number, offset: number): SessionRecord[];
  getAutomaticSessions(limit: number, offset: number): SessionRecord[];
  getSessionById(id: string): SessionRecord | undefined;
  getMessagesBySessionId(sessionId: string): MessageRecord[];
  searchMessages(query: string, limit: number, offset: number, sort?: SortOption, automaticOnly?: boolean): SearchResultRecord[];

  // Write (routes)
  markSessionAsRead(id: string): void;
  hideSession(id: string): void;

  // Indexing (indexer)
  getSessionLastIndexed(id: string): LastIndexedRecord | undefined;
  indexSession(params: IndexSessionParams): void;
}
