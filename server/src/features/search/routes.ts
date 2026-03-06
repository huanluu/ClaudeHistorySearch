import { type Router, type Request, type Response } from 'express';
import type { SessionRepository, SortOption } from '../../shared/provider/index';
import type { Logger } from '../../shared/provider/index';
import { indexAllSessions } from './indexer';
import type { IndexAllResult } from './indexer';

export interface SearchRouteDeps {
  repo: SessionRepository;
  logger: Logger;
  indexFn?: (force: boolean, repo: SessionRepository, logger: Logger) => Promise<IndexAllResult>;
}

// API Response types
interface SessionResponse {
  id: string;
  project: string;
  startedAt: number;
  messageCount: number;
  preview: string | null;
  title: string | null;
  isAutomatic: boolean;
  isUnread: boolean;
}

interface MessageResponse {
  uuid: string;
  role: string;
  content: string;
  timestamp: number | null;
}

interface PaginationResponse {
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface SearchResultResponse {
  sessionId: string;
  project: string;
  sessionStartedAt: number;
  title: string | null;
  message: {
    uuid: string;
    role: string;
    content: string;
    highlightedContent: string;
    timestamp: number | null;
  };
}

export function registerSearchRoutes(router: Router, deps: SearchRouteDeps): void {
  const { repo, logger, indexFn = indexAllSessions } = deps;

  /**
   * GET /sessions
   * List recent sessions with pagination
   */
  router.get('/sessions', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const automaticParam = req.query.automatic as string | undefined;
      let sessions;
      if (automaticParam === 'true') {
        sessions = repo.getAutomaticSessions(limit, offset);
      } else if (automaticParam === 'false') {
        sessions = repo.getManualSessions(limit, offset);
      } else {
        sessions = repo.getRecentSessions(limit, offset);
      }

      res.json({
        sessions: sessions.map((s): SessionResponse => ({
          id: s.id,
          project: s.project,
          startedAt: s.started_at,
          messageCount: s.message_count,
          preview: s.preview,
          title: s.title,
          isAutomatic: s.is_automatic === 1,
          isUnread: s.is_unread === 1
        })),
        pagination: {
          limit,
          offset,
          hasMore: sessions.length === limit
        } as PaginationResponse
      });
    } catch (error) {
      logger.error({ msg: 'Error fetching sessions', op: 'sessions.list', err: error, errType: 'db_error' });
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  /**
   * GET /sessions/:id
   * Get full conversation for a session
   */
  router.get('/sessions/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const session = repo.getSessionById(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const messages = repo.getMessagesBySessionId(id);

      res.json({
        session: {
          id: session.id,
          project: session.project,
          startedAt: session.started_at,
          messageCount: session.message_count,
          preview: session.preview,
          title: session.title,
          isAutomatic: session.is_automatic === 1,
          isUnread: session.is_unread === 1
        } as SessionResponse,
        messages: messages.map((m): MessageResponse => ({
          uuid: m.uuid,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        }))
      });
    } catch (error) {
      logger.error({ msg: 'Error fetching session', op: 'sessions.get', err: error, errType: 'db_error' });
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  });

  /**
   * GET /search
   * Full-text search across all messages
   */
  router.get('/search', (req: Request, res: Response) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim().length === 0) {
        res.status(400).json({ error: 'Search query is required' });
        return;
      }

      const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const offsetParam = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
      const sortParam = Array.isArray(req.query.sort) ? req.query.sort[0] : req.query.sort;

      const limit = Math.min(parseInt(limitParam as string) || 50, 200);
      const offset = parseInt(offsetParam as string) || 0;
      const sort: SortOption = sortParam === 'date' ? 'date' : 'relevance';

      const sanitizedQuery = query
        .replace(/['"*()]/g, '')
        .split(/\s+/)
        .filter(term => term.length > 0)
        .map(term => `${term}*`)
        .join(' ');

      if (!sanitizedQuery) {
        res.status(400).json({ error: 'Invalid search query' });
        return;
      }

      const automaticSearchParam = req.query.automatic as string | undefined;
      const automaticOnly = automaticSearchParam === 'true';

      const fetchLimit = (limit + offset) * 3;
      const allResults = repo.searchMessages(sanitizedQuery, fetchLimit, 0, sort, automaticOnly);

      const seenSessions = new Set<string>();
      const uniqueResults: typeof allResults = [];

      for (const r of allResults) {
        if (!seenSessions.has(r.session_id)) {
          seenSessions.add(r.session_id);
          uniqueResults.push(r);
        }
      }

      const paginatedResults = uniqueResults.slice(offset, offset + limit);

      logger.log({ msg: `Search: "${query}" → ${uniqueResults.length} sessions`, op: 'search.query', context: { query, results: uniqueResults.length, sort } });

      res.json({
        results: paginatedResults.map((r): SearchResultResponse => ({
          sessionId: r.session_id,
          project: r.project,
          sessionStartedAt: r.started_at,
          title: r.title,
          message: {
            uuid: r.uuid,
            role: r.role,
            content: r.content,
            highlightedContent: r.highlighted_content,
            timestamp: r.timestamp
          }
        })),
        pagination: {
          limit,
          offset,
          hasMore: uniqueResults.length > offset + limit
        } as PaginationResponse,
        query,
        sort
      });
    } catch (error) {
      logger.error({ msg: 'Error searching', op: 'search.query', err: error, errType: 'db_error' });
      res.status(500).json({ error: 'Search failed' });
    }
  });

  /**
   * DELETE /sessions/:id
   */
  router.delete('/sessions/:id', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const session = repo.getSessionById(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      repo.hideSession(id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ msg: 'Error deleting session', op: 'sessions.delete', err: error, errType: 'db_error' });
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  /**
   * POST /sessions/:id/read
   */
  router.post('/sessions/:id/read', (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const session = repo.getSessionById(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      repo.markSessionAsRead(id);
      res.json({ success: true });
    } catch (error) {
      logger.error({ msg: 'Error marking session as read', op: 'sessions.read', err: error, errType: 'db_error' });
      res.status(500).json({ error: 'Failed to mark session as read' });
    }
  });

  /**
   * POST /reindex
   */
  router.post('/reindex', async (req: Request, res: Response) => {
    try {
      const force = req.query.force === 'true';
      const result = await indexFn(force, repo, logger);
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      logger.error({ msg: 'Error reindexing', op: 'server.reindex', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Reindex failed' });
    }
  });
}
