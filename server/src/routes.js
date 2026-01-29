import { Router } from 'express';
import {
  getRecentSessions,
  getSessionById,
  getMessagesBySessionId,
  searchMessages
} from './database.js';
import { indexAllSessions } from './indexer.js';

const router = Router();

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
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
router.get('/sessions', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const sessions = getRecentSessions.all(limit, offset);

    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        project: s.project,
        startedAt: s.started_at,
        messageCount: s.message_count,
        preview: s.preview,
        title: s.title
      })),
      pagination: {
        limit,
        offset,
        hasMore: sessions.length === limit
      }
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * GET /sessions/:id
 * Get full conversation for a session
 */
router.get('/sessions/:id', (req, res) => {
  try {
    const { id } = req.params;

    const session = getSessionById.get(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const messages = getMessagesBySessionId.all(id);

    res.json({
      session: {
        id: session.id,
        project: session.project,
        startedAt: session.started_at,
        messageCount: session.message_count,
        preview: session.preview,
        title: session.title
      },
      messages: messages.map(m => ({
        uuid: m.uuid,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }))
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * GET /search
 * Full-text search across all messages
 * Query params: q (search query), limit (default 50), offset (default 0)
 */
router.get('/search', (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    // Escape special FTS5 characters and format query with prefix matching
    const sanitizedQuery = query
      .replace(/['"*()]/g, '')  // Remove special FTS5 characters
      .split(/\s+/)
      .filter(term => term.length > 0)
      .map(term => `${term}*`)  // Add * for prefix matching (without quotes)
      .join(' ');

    if (!sanitizedQuery) {
      return res.status(400).json({ error: 'Invalid search query' });
    }

    const results = searchMessages.all(sanitizedQuery, limit, offset);

    res.json({
      results: results.map(r => ({
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
        hasMore: results.length === limit
      },
      query
    });
  } catch (error) {
    console.error('Error searching:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * POST /reindex
 * Trigger a full reindex of all sessions
 */
router.post('/reindex', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const result = await indexAllSessions(force);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error reindexing:', error);
    res.status(500).json({ error: 'Reindex failed' });
  }
});

export default router;
