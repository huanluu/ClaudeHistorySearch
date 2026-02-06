import { Router, type Request, type Response } from 'express';
import {
  db,
  getRecentSessions,
  getSessionById,
  getMessagesBySessionId,
  searchMessages,
  markSessionAsRead,
  getAllHeartbeatState,
  type SessionRecord,
  type MessageRecord,
  type SearchResultRecord,
  type SortOption,
  type HeartbeatStateRecord
} from './database.js';
import { indexAllSessions } from './indexer.js';
import { HeartbeatService } from './services/HeartbeatService.js';
import { logger } from './logger.js';

// Singleton heartbeat service for API routes
let heartbeatService: HeartbeatService | null = null;

export function setHeartbeatService(service: HeartbeatService): void {
  heartbeatService = service;
}

const router = Router();

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

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /sessions
 * List recent sessions with pagination
 * Query params: limit (default 20), offset (default 0)
 */
router.get('/sessions', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const sessions = getRecentSessions.all(limit, offset) as SessionRecord[];

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
    logger.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /sessions/:id
 * Get full conversation for a session
 */
router.get('/sessions/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const session = getSessionById.get(id) as SessionRecord | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages = getMessagesBySessionId.all(id) as MessageRecord[];

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
    logger.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * GET /search
 * Full-text search across all messages, grouped by session
 * Query params: q (search query), limit (default 50), offset (default 0), sort (relevance|date)
 * Returns only the best-matching message per session
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

    // Escape special FTS5 characters and format query with prefix matching
    const sanitizedQuery = query
      .replace(/['"*()]/g, '')  // Remove special FTS5 characters
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `${term}*`)  // Add * for prefix matching (without quotes)
      .join(' ');

    if (!sanitizedQuery) {
      res.status(400).json({ error: 'Invalid search query' });
      return;
    }

    // Fetch more results than needed to account for deduplication
    const fetchLimit = (limit + offset) * 3;
    const allResults = searchMessages(sanitizedQuery, fetchLimit, 0, sort);

    // Group by session - keep only the best-matching message per session
    // Results are already ordered by rank, so first occurrence is best match
    const seenSessions = new Set<string>();
    const uniqueResults: SearchResultRecord[] = [];

    for (const r of allResults) {
      if (!seenSessions.has(r.session_id)) {
        seenSessions.add(r.session_id);
        uniqueResults.push(r);
      }
    }

    // Apply pagination to deduplicated results
    const paginatedResults = uniqueResults.slice(offset, offset + limit);

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
    logger.error('Error searching:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * POST /reindex
 * Trigger a full reindex of all sessions
 */
router.post('/reindex', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    const result = await indexAllSessions(force);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('Error reindexing:', error);
    res.status(500).json({ error: 'Reindex failed' });
  }
});

/**
 * POST /sessions/:id/read
 * Mark a session as read (removes unread indicator)
 */
router.post('/sessions/:id/read', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if session exists
    const session = getSessionById.get(id) as SessionRecord | undefined;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Mark as read
    markSessionAsRead.run(id);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking session as read:', error);
    res.status(500).json({ error: 'Failed to mark session as read' });
  }
});

/**
 * POST /heartbeat
 * Manually trigger a heartbeat run (for testing/debugging)
 */
router.post('/heartbeat', async (_req: Request, res: Response) => {
  try {
    if (!heartbeatService) {
      res.status(503).json({ error: 'Heartbeat service not initialized' });
      return;
    }

    const result = await heartbeatService.runHeartbeat(true);
    res.json(result);
  } catch (error) {
    logger.error('Error running heartbeat:', error);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
});

/**
 * GET /heartbeat/status
 * Get the current heartbeat status and state
 */
router.get('/heartbeat/status', (_req: Request, res: Response) => {
  try {
    const state = getAllHeartbeatState.all() as HeartbeatStateRecord[];
    const config = heartbeatService?.getConfig();

    res.json({
      enabled: config?.enabled ?? false,
      intervalMs: config?.intervalMs ?? 0,
      workingDirectory: config?.workingDirectory ?? '',
      state: state.map(s => ({
        key: s.key,
        lastChanged: s.last_changed,
        lastProcessed: s.last_processed
      }))
    });
  } catch (error) {
    logger.error('Error getting heartbeat status:', error);
    res.status(500).json({ error: 'Failed to get heartbeat status' });
  }
});

export default router;
