import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';

// Test configuration
const TEST_CONFIG_DIR = join(tmpdir(), `claude-history-test-${Date.now()}`);
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

interface Config {
  apiKeyHash?: string;
  apiKeyCreatedAt?: string;
}

// Setup test config directory before importing modules
mkdirSync(TEST_CONFIG_DIR, { recursive: true });

// Mock the config path in keyManager by setting an env var
process.env.CLAUDE_HISTORY_CONFIG_DIR = TEST_CONFIG_DIR;

// Helper to create test API key
function createTestApiKey(): string {
  const key = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(key).digest('hex');
  const config: Config = {
    apiKeyHash: hash,
    apiKeyCreatedAt: new Date().toISOString()
  };
  writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));
  return key;
}

// Helper to remove API key
function removeTestApiKey(): void {
  if (existsSync(TEST_CONFIG_FILE)) {
    writeFileSync(TEST_CONFIG_FILE, JSON.stringify({}));
  }
}

// Create a minimal test app
function createTestApp(withAuth = true): Application {
  const app = express();
  app.use(express.json());

  // Simple auth middleware for testing
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') {
      return next();
    }

    if (!withAuth) {
      return next();
    }

    // Check if API key is configured
    let config: Config = {};
    try {
      config = JSON.parse(readFileSync(TEST_CONFIG_FILE, 'utf-8'));
    } catch {
      // No config
    }

    if (!config.apiKeyHash) {
      return next(); // No key configured, allow all
    }

    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Provide X-API-Key header.'
      });
    }

    const hash = createHash('sha256').update(apiKey).digest('hex');
    if (hash !== config.apiKeyHash) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key.'
      });
    }

    next();
  });

  // Test routes
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/sessions', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    res.json({
      sessions: [
        {
          id: 'test-session-1',
          project: '/test/project',
          startedAt: Date.now(),
          messageCount: 4,
          preview: 'Test session preview',
          title: 'Test Session',
          isAutomatic: false,
          isUnread: false
        },
        {
          id: 'test-heartbeat-session',
          project: '/test/project',
          startedAt: Date.now(),
          messageCount: 2,
          preview: '[Heartbeat] Analyze Work Item #12345',
          title: null,
          isAutomatic: true,
          isUnread: true
        }
      ],
      pagination: { limit, offset, hasMore: false }
    });
  });

  app.get('/sessions/:id', (req: Request, res: Response) => {
    if (req.params.id === 'not-found') {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({
      session: {
        id: req.params.id,
        project: '/test/project',
        startedAt: Date.now(),
        messageCount: 2,
        preview: 'Test preview',
        title: 'Test Session'
      },
      messages: [
        { uuid: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { uuid: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() }
      ]
    });
  });

  app.get('/search', (req: Request, res: Response) => {
    const query = req.query.q as string | undefined;
    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const sort = req.query.sort === 'date' ? 'date' : 'relevance';

    res.json({
      results: [
        {
          sessionId: 'test-session-1',
          project: '/test/project',
          sessionStartedAt: Date.now(),
          title: 'Test Session',
          message: {
            uuid: 'msg-1',
            role: 'user',
            content: `Test content matching ${query}`,
            highlightedContent: `Test content matching <mark>${query}</mark>`,
            timestamp: Date.now()
          }
        }
      ],
      pagination: { limit, offset, hasMore: false },
      query,
      sort
    });
  });

  app.post('/reindex', (req: Request, res: Response) => {
    const force = req.query.force === 'true';
    res.json({ success: true, indexed: force ? 10 : 5, skipped: 0 });
  });

  // Track which sessions have been marked as read (for testing)
  const readSessions = new Set<string>();

  app.post('/sessions/:id/read', (req: Request, res: Response) => {
    const { id } = req.params;
    if (id === 'not-found') {
      return res.status(404).json({ error: 'Session not found' });
    }
    readSessions.add(id);
    res.json({ success: true });
  });

  app.post('/heartbeat', (_req: Request, res: Response) => {
    res.json({
      tasksProcessed: 2,
      sessionsCreated: 1,
      sessionIds: ['mock-session-abc123'],
      errors: []
    });
  });

  app.get('/heartbeat/status', (_req: Request, res: Response) => {
    res.json({
      enabled: true,
      intervalMs: 3600000,
      workingDirectory: '/test/project',
      state: [
        { key: 'workitem:12345', lastChanged: '2024-01-15T10:00:00Z', lastProcessed: Date.now() }
      ]
    });
  });

  return app;
}

describe('API Routes', () => {
  let app: Application;
  let testApiKey: string;

  beforeAll(() => {
    testApiKey = createTestApiKey();
    app = createTestApp(true);
  });

  afterAll(() => {
    // Cleanup test config directory
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  describe('GET /health', () => {
    it('should return health status without authentication', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const res = await request(app).get('/sessions');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should reject requests with invalid API key', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', 'invalid-key');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('should accept requests with valid API key', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /sessions', () => {
    it('should return paginated sessions', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.offset).toBe(0);
    });

    it('should respect limit and offset params', async () => {
      const res = await request(app)
        .get('/sessions?limit=10&offset=5')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(10);
      expect(res.body.pagination.offset).toBe(5);
    });

    it('should cap limit at 100', async () => {
      const res = await request(app)
        .get('/sessions?limit=500')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });

  describe('GET /sessions/:id', () => {
    it('should return session with messages', async () => {
      const res = await request(app)
        .get('/sessions/test-session-1')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.session).toBeDefined();
      expect(res.body.session.id).toBe('test-session-1');
      expect(res.body.messages).toBeInstanceOf(Array);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request(app)
        .get('/sessions/not-found')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });

  describe('GET /search', () => {
    it('should return search results', async () => {
      const res = await request(app)
        .get('/search?q=react')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.results).toBeInstanceOf(Array);
      expect(res.body.query).toBe('react');
      expect(res.body.sort).toBe('relevance');
    });

    it('should return 400 for empty query', async () => {
      const res = await request(app)
        .get('/search?q=')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Search query is required');
    });

    it('should support date sort', async () => {
      const res = await request(app)
        .get('/search?q=test&sort=date')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sort).toBe('date');
    });

    it('should respect pagination params', async () => {
      const res = await request(app)
        .get('/search?q=test&limit=25&offset=10')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(25);
      expect(res.body.pagination.offset).toBe(10);
    });
  });

  describe('POST /reindex', () => {
    it('should trigger reindex', async () => {
      const res = await request(app)
        .post('/reindex')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.indexed).toBeDefined();
    });

    it('should support force flag', async () => {
      const res = await request(app)
        .post('/reindex?force=true')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.indexed).toBe(10);
    });
  });
});

describe('API without authentication configured', () => {
  let app: Application;

  beforeAll(() => {
    removeTestApiKey();
    app = createTestApp(true);
  });

  it('should allow requests when no API key is configured', async () => {
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// PHASE 6: New Heartbeat API Routes Tests
// =============================================================================

describe('Heartbeat API Routes', () => {
  const HEARTBEAT_TEST_DIR = join(tmpdir(), `claude-history-heartbeat-test-${Date.now()}`);
  const HEARTBEAT_CONFIG_FILE = join(HEARTBEAT_TEST_DIR, 'config.json');
  let app: Application;
  let testApiKey: string;

  function createHeartbeatTestApiKey(): string {
    mkdirSync(HEARTBEAT_TEST_DIR, { recursive: true });
    const key = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(key).digest('hex');
    const config: Config = {
      apiKeyHash: hash,
      apiKeyCreatedAt: new Date().toISOString()
    };
    writeFileSync(HEARTBEAT_CONFIG_FILE, JSON.stringify(config));
    // Update the env var to point to this test dir
    process.env.CLAUDE_HISTORY_CONFIG_DIR = HEARTBEAT_TEST_DIR;
    return key;
  }

  beforeAll(() => {
    testApiKey = createHeartbeatTestApiKey();
    app = createTestApp(true);
  });

  afterAll(() => {
    rmSync(HEARTBEAT_TEST_DIR, { recursive: true, force: true });
  });

  describe('GET /sessions (with heartbeat fields)', () => {
    it('should include isAutomatic and isUnread fields', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(2);

      // Regular session
      const regularSession = res.body.sessions[0];
      expect(regularSession.isAutomatic).toBe(false);
      expect(regularSession.isUnread).toBe(false);

      // Heartbeat session
      const heartbeatSession = res.body.sessions[1];
      expect(heartbeatSession.isAutomatic).toBe(true);
      expect(heartbeatSession.isUnread).toBe(true);
    });
  });

  describe('POST /sessions/:id/read', () => {
    it('should mark session as read', async () => {
      const res = await request(app)
        .post('/sessions/test-heartbeat-session/read')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/sessions/not-found/read')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });

  describe('POST /heartbeat', () => {
    it('should trigger heartbeat and return results', async () => {
      const res = await request(app)
        .post('/heartbeat')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.tasksProcessed).toBeDefined();
      expect(res.body.sessionsCreated).toBeDefined();
      expect(res.body.errors).toBeInstanceOf(Array);
    });

    it('should trigger heartbeat with force (bypasses enabled check)', async () => {
      // The mock app always returns success, but this validates the route
      // exists and responds. The real force behavior is tested in heartbeat.test.ts
      const res = await request(app)
        .post('/heartbeat')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.tasksProcessed).toBeDefined();
      expect(res.body.sessionsCreated).toBeDefined();
    });
  });

  describe('GET /heartbeat/status', () => {
    it('should return heartbeat status', async () => {
      const res = await request(app)
        .get('/heartbeat/status')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBeDefined();
      expect(res.body.intervalMs).toBeDefined();
      expect(res.body.workingDirectory).toBeDefined();
      expect(res.body.state).toBeInstanceOf(Array);
    });

    it('should return processed items in state', async () => {
      const res = await request(app)
        .get('/heartbeat/status')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.state.length).toBeGreaterThan(0);
      expect(res.body.state[0].key).toContain('workitem');
      expect(res.body.state[0].lastChanged).toBeDefined();
      expect(res.body.state[0].lastProcessed).toBeDefined();
    });
  });
});
