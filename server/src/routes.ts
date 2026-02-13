import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Router, type Request, type Response } from 'express';
import {
  getAllHeartbeatState,
  type SessionRepository,
  type SortOption,
  type HeartbeatStateRecord
} from './database/index.js';
import { indexAllSessions } from './indexer.js';
import { HeartbeatService } from './services/HeartbeatService.js';
import { logger } from './logger.js';
import { ConfigService } from './services/ConfigService.js';

// Read admin.html at module load
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const adminHtml = readFileSync(join(__dirname, 'admin', 'admin.html'), 'utf-8');

// Singleton heartbeat service for API routes
let heartbeatService: HeartbeatService | null = null;

export function setHeartbeatService(service: HeartbeatService): void {
  heartbeatService = service;
}

// Config service for admin UI
let configService: ConfigService | null = null;

export function setConfigService(service: ConfigService): void {
  configService = service;
}

// Callback to restart heartbeat timer after config change
let onConfigChanged: ((section: string) => void) | null = null;

export function setOnConfigChanged(callback: (section: string) => void): void {
  onConfigChanged = callback;
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

export function createRouter(repo: SessionRepository): Router {
  const router = Router();

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

      // Escape special FTS5 characters and format query with prefix matching.
      // The FTS5 table uses unicode61 tokenizer (no porter stemmer) so * gives
      // clean prefix matching without stemmer-induced false positives.
      const sanitizedQuery = query
        .replace(/['"*()]/g, '')  // Remove special FTS5 characters
        .split(/\s+/)
        .filter(term => term.length > 0)
        .map(term => `${term}*`)  // Add * for prefix matching
        .join(' ');

      if (!sanitizedQuery) {
        res.status(400).json({ error: 'Invalid search query' });
        return;
      }

      // Parse automatic filter for tab-specific search
      const automaticSearchParam = req.query.automatic as string | undefined;
      const automaticOnly = automaticSearchParam === 'true';

      // Fetch more results than needed to account for deduplication
      const fetchLimit = (limit + offset) * 3;
      const allResults = repo.searchMessages(sanitizedQuery, fetchLimit, 0, sort, automaticOnly);

      // Group by session - keep only the best-matching message per session
      // Results are already ordered by rank, so first occurrence is best match
      const seenSessions = new Set<string>();
      const uniqueResults: typeof allResults = [];

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
   * DELETE /sessions/:id
   * Soft-delete a session by marking it as hidden
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
      logger.error('Error deleting session:', error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  /**
   * POST /reindex
   * Trigger a full reindex of all sessions
   */
  router.post('/reindex', async (req: Request, res: Response) => {
    try {
      const force = req.query.force === 'true';
      const result = await indexAllSessions(force, repo);
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
      const id = req.params.id as string;

      // Check if session exists
      const session = repo.getSessionById(id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Mark as read
      repo.markSessionAsRead(id);

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

  /**
   * GET /admin
   * Serve the admin control panel HTML page
   */
  router.get('/admin', (_req: Request, res: Response) => {
    res.type('html').send(adminHtml);
  });

  /**
   * GET /api/config
   * Return all editable config sections
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }
      res.json(configService.getAllEditableSections());
    } catch (error) {
      logger.error('Error reading config:', error);
      res.status(500).json({ error: 'Failed to read config' });
    }
  });

  /**
   * GET /api/config/:section
   * Return a single editable config section
   */
  router.get('/api/config/:section', (req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }
      const sectionName = req.params.section as string;
      const section = configService.getSection(sectionName);
      if (section === null) {
        res.status(404).json({ error: `Unknown section: ${sectionName}` });
        return;
      }
      res.json(section);
    } catch (error) {
      logger.error('Error reading config section:', error);
      res.status(500).json({ error: 'Failed to read config section' });
    }
  });

  /**
   * PUT /api/config/:section
   * Update a single editable config section
   */
  router.put('/api/config/:section', (req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }

      const sectionName = req.params.section as string;
      const validationError = configService.updateSection(sectionName, req.body);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      // Trigger hot reload callback
      if (onConfigChanged) {
        onConfigChanged(sectionName);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Error updating config section:', error);
      res.status(500).json({ error: 'Failed to update config section' });
    }
  });

  return router;
}
