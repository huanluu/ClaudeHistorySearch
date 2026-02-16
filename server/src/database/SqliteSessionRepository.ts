import { statSync } from 'fs';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import type { SessionRecord, MessageRecord, SearchResultRecord, SortOption, LastIndexedRecord } from './connection.js';
import type { SessionRepository, IndexSessionParams, DatabaseStats } from './interfaces.js';

export class SqliteSessionRepository implements SessionRepository {
  private readonly db: DatabaseType;
  private readonly stmts: {
    getRecentSessions: Statement<unknown[], SessionRecord>;
    getManualSessions: Statement<unknown[], SessionRecord>;
    getAutomaticSessions: Statement<unknown[], SessionRecord>;
    getSessionById: Statement<unknown[], SessionRecord>;
    getMessagesBySessionId: Statement<unknown[], MessageRecord>;
    searchMessagesByRelevance: Statement<unknown[], SearchResultRecord>;
    searchMessagesByDate: Statement<unknown[], SearchResultRecord>;
    markSessionAsRead: Statement;
    hideSession: Statement;
    getSessionLastIndexed: Statement<unknown[], LastIndexedRecord>;
    insertSession: Statement;
    insertMessage: Statement;
    clearSessionMessages: Statement;
  };

  private readonly indexSessionTx: (params: IndexSessionParams) => void;

  constructor(db: DatabaseType) {
    this.db = db;
    this.stmts = {
      getRecentSessions: db.prepare(`
        SELECT * FROM sessions
        WHERE is_hidden = 0
        ORDER BY COALESCE(last_activity_at, started_at) DESC
        LIMIT ? OFFSET ?
      `),

      getManualSessions: db.prepare(`
        SELECT * FROM sessions
        WHERE is_automatic = 0 AND is_hidden = 0
        ORDER BY COALESCE(last_activity_at, started_at) DESC
        LIMIT ? OFFSET ?
      `),

      getAutomaticSessions: db.prepare(`
        SELECT * FROM sessions
        WHERE is_automatic = 1 AND is_hidden = 0
        ORDER BY COALESCE(last_activity_at, started_at) DESC
        LIMIT ? OFFSET ?
      `),

      getSessionById: db.prepare(`SELECT * FROM sessions WHERE id = ?`),

      getMessagesBySessionId: db.prepare(`
        SELECT session_id, role, content, timestamp, uuid
        FROM messages_fts
        WHERE session_id = ?
        ORDER BY timestamp ASC
      `),

      searchMessagesByRelevance: db.prepare(`
        SELECT
          messages_fts.session_id,
          messages_fts.role,
          messages_fts.content,
          messages_fts.timestamp,
          messages_fts.uuid,
          sessions.project,
          sessions.started_at,
          sessions.title,
          highlight(messages_fts, 2, '<mark>', '</mark>') as highlighted_content,
          bm25(messages_fts) as rank
        FROM messages_fts
        JOIN sessions ON sessions.id = messages_fts.session_id
        WHERE messages_fts MATCH ? AND sessions.is_automatic = ? AND sessions.is_hidden = 0
        ORDER BY rank
        LIMIT ? OFFSET ?
      `),

      searchMessagesByDate: db.prepare(`
        SELECT
          messages_fts.session_id,
          messages_fts.role,
          messages_fts.content,
          messages_fts.timestamp,
          messages_fts.uuid,
          sessions.project,
          sessions.started_at,
          sessions.title,
          highlight(messages_fts, 2, '<mark>', '</mark>') as highlighted_content,
          bm25(messages_fts) as rank
        FROM messages_fts
        JOIN sessions ON sessions.id = messages_fts.session_id
        WHERE messages_fts MATCH ? AND sessions.is_automatic = ? AND sessions.is_hidden = 0
        ORDER BY sessions.started_at DESC, rank
        LIMIT ? OFFSET ?
      `),

      markSessionAsRead: db.prepare(`UPDATE sessions SET is_unread = 0 WHERE id = ?`),
      hideSession: db.prepare(`UPDATE sessions SET is_hidden = 1 WHERE id = ?`),

      getSessionLastIndexed: db.prepare(`SELECT last_indexed FROM sessions WHERE id = ?`),

      insertSession: db.prepare(`
        INSERT OR REPLACE INTO sessions (id, project, started_at, last_activity_at, message_count, preview, title, last_indexed, is_automatic, is_unread)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),

      insertMessage: db.prepare(`
        INSERT INTO messages_fts (session_id, role, content, timestamp, uuid)
        VALUES (?, ?, ?, ?, ?)
      `),

      clearSessionMessages: db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`),
    };

    this.indexSessionTx = db.transaction((params: IndexSessionParams) => {
      this.stmts.clearSessionMessages.run(params.sessionId);
      this.stmts.insertSession.run(
        params.sessionId,
        params.project,
        params.startedAt,
        params.lastActivityAt,
        params.messageCount,
        params.preview,
        params.title,
        params.lastIndexed,
        params.isAutomatic ? 1 : 0,
        params.isAutomatic ? 1 : 0  // is_unread: new automatic sessions are unread
      );
      for (const msg of params.messages) {
        this.stmts.insertMessage.run(
          params.sessionId,
          msg.role,
          msg.content,
          msg.timestamp,
          msg.uuid
        );
      }
    });
  }

  getRecentSessions(limit: number, offset: number): SessionRecord[] {
    return this.stmts.getRecentSessions.all(limit, offset);
  }

  getManualSessions(limit: number, offset: number): SessionRecord[] {
    return this.stmts.getManualSessions.all(limit, offset);
  }

  getAutomaticSessions(limit: number, offset: number): SessionRecord[] {
    return this.stmts.getAutomaticSessions.all(limit, offset);
  }

  getSessionById(id: string): SessionRecord | undefined {
    return this.stmts.getSessionById.get(id);
  }

  getMessagesBySessionId(sessionId: string): MessageRecord[] {
    return this.stmts.getMessagesBySessionId.all(sessionId);
  }

  searchMessages(
    query: string,
    limit: number,
    offset: number,
    sort: SortOption = 'relevance',
    automaticOnly: boolean = false
  ): SearchResultRecord[] {
    const automaticFlag = automaticOnly ? 1 : 0;
    const stmt = sort === 'date' ? this.stmts.searchMessagesByDate : this.stmts.searchMessagesByRelevance;
    return stmt.all(query, automaticFlag, limit, offset);
  }

  markSessionAsRead(id: string): void {
    this.stmts.markSessionAsRead.run(id);
  }

  hideSession(id: string): void {
    this.stmts.hideSession.run(id);
  }

  getSessionLastIndexed(id: string): LastIndexedRecord | undefined {
    return this.stmts.getSessionLastIndexed.get(id);
  }

  indexSession(params: IndexSessionParams): void {
    this.indexSessionTx(params);
  }

  getStats(dbPath: string): DatabaseStats {
    const sessionRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM sessions WHERE is_hidden = 0`).get() as { cnt: number };
    const messageRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM messages_fts`).get() as { cnt: number };
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(dbPath).size;
    } catch {
      // File may not exist in test environments
    }
    return {
      sessionCount: sessionRow.cnt,
      messageCount: messageRow.cnt,
      dbSizeBytes,
    };
  }
}
