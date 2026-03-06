/**
 * Domain contracts — types and interfaces shared across features.
 * This file must only contain types/interfaces, never values.
 *
 * Features import these to define their dependencies.
 * Infra (shared/infra/) implements the repository interfaces.
 * Composition root (app.ts) wires implementations to features.
 */

import type { Logger } from './logger/logger';

// ── Record types (database row shapes) ─────────────────────────────

export interface SessionRecord {
  id: string;
  project: string;
  started_at: number;
  last_activity_at: number | null;
  message_count: number;
  preview: string | null;
  title: string | null;
  last_indexed: number | null;
  is_automatic: number;
  is_unread: number;
  is_hidden: number;
  source: string;
}

export interface HeartbeatStateRecord {
  key: string;
  last_changed: string | null;
  last_processed: number | null;
}

export interface MessageRecord {
  session_id: string;
  role: string;
  content: string;
  timestamp: number | null;
  uuid: string;
}

export interface SearchResultRecord extends MessageRecord {
  project: string;
  started_at: number;
  title: string | null;
  highlighted_content: string;
  rank: number;
}

export interface LastIndexedRecord {
  last_indexed: number | null;
}

export type SortOption = 'relevance' | 'date';

// ── Repository interfaces ──────────────────────────────────────────

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
  source: string;
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

  // Stats (diagnostics)
  getStats(dbPath: string): DatabaseStats;
}

export interface DatabaseStats {
  sessionCount: number;
  messageCount: number;
  dbSizeBytes: number;
}

export interface HeartbeatRepository {
  getState(key: string): HeartbeatStateRecord | undefined;
  upsertState(key: string, lastChanged: string, lastProcessed: number): void;
  getAllState(): HeartbeatStateRecord[];
}

// ── Parsed types (anti-corruption layer output) ─────────────────────

export interface ParsedMessage {
  uuid: string;
  role: string;
  content: string;
  timestamp: number | null;
}

export interface ParsedSession {
  sessionId: string | null;
  project: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  preview: string | null;
  source: string;
  messages: ParsedMessage[];
}

// ── Session source interface (anti-corruption boundary) ─────────────

export interface SessionSource {
  readonly name: string;
  readonly sessionDir: string;
  readonly filePattern: string;
  parse(filePath: string): Promise<ParsedSession>;
}

// ── CLI runtime interfaces (write-side abstraction) ─────────────────

export interface SessionStartOptions {
  prompt: string;
  workingDir: string;
  resumeSessionId?: string;
}

export interface HeadlessRunOptions {
  prompt: string;
  workingDir: string;
}

/**
 * A running agent session that produces output over time.
 * Consumers listen for messages, errors, and completion.
 */
export interface AgentSession {
  start(options: SessionStartOptions): void;
  cancel(): void;
  getSessionId(): string;
  on(event: 'message', handler: (message: unknown) => void): unknown;
  on(event: 'error', handler: (error: string) => void): unknown;
  on(event: 'complete', handler: (exitCode: number) => void): unknown;
}

/**
 * A CLI runtime that can spawn agent sessions.
 * Implementations exist per CLI tool (Claude, Copilot, etc.).
 */
export interface CliRuntime {
  readonly name: string;
  startSession(sessionId: string, logger: Logger): AgentSession;
  runHeadless(options: HeadlessRunOptions, logger: Logger): Promise<{ sessionId: string | null }>;
}
