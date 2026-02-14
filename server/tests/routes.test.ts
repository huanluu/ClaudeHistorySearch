import request from 'supertest';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { jest } from '@jest/globals';
import type { SessionRepository } from '../src/database/interfaces.js';
import type { SessionRecord, MessageRecord, SearchResultRecord } from '../src/database/connection.js';
import { createRouter, type RouteDeps } from '../src/api/index.js';

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

// Mock SessionRepository factory
function createMockRepository(overrides?: Partial<SessionRepository>): SessionRepository {
  return {
    getRecentSessions: () => [],
    getManualSessions: () => [],
    getAutomaticSessions: () => [],
    getSessionById: () => undefined,
    getMessagesBySessionId: () => [],
    searchMessages: () => [],
    markSessionAsRead: () => {},
    hideSession: () => {},
    getSessionLastIndexed: () => undefined,
    indexSession: () => {},
    ...overrides,
  };
}

// Create a test app that uses the real createRouter with RouteDeps
function createTestApp(deps: RouteDeps, withAuth = true): Application {
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

  // Mount the REAL router with deps
  app.use('/', createRouter(deps));

  return app;
}

// Sample test records
const now = Date.now();

const sampleSession: SessionRecord = {
  id: 'test-session-1',
  project: '/test/project',
  started_at: now - 86400000,
  last_activity_at: now - 86000000,
  message_count: 4,
  preview: 'How do I create a React component?',
  title: 'React Tutorial',
  last_indexed: now,
  is_automatic: 0,
  is_unread: 0,
  is_hidden: 0,
};

const heartbeatSession: SessionRecord = {
  id: 'test-heartbeat-session',
  project: '/test/project',
  started_at: now - 3600000,
  last_activity_at: now - 3500000,
  message_count: 2,
  preview: '[Heartbeat] Analyze Work Item #12345',
  title: null,
  last_indexed: now,
  is_automatic: 1,
  is_unread: 1,
  is_hidden: 0,
};

const sampleMessages: MessageRecord[] = [
  { session_id: 'test-session-1', role: 'user', content: 'How do I create a React component?', timestamp: now - 86400000, uuid: 'msg-001' },
  { session_id: 'test-session-1', role: 'assistant', content: 'You can use a function component.', timestamp: now - 86300000, uuid: 'msg-002' },
];

const sampleSearchResults: SearchResultRecord[] = [
  {
    session_id: 'test-session-1',
    role: 'user',
    content: 'How do I create a React component?',
    timestamp: now - 86400000,
    uuid: 'msg-001',
    project: '/test/project',
    started_at: now - 86400000,
    title: 'React Tutorial',
    highlighted_content: 'How do I create a <mark>React</mark> component?',
    rank: -1.5,
  },
];

describe('API Routes (with mock repository)', () => {
  let app: Application;
  let testApiKey: string;
  let mockRepo: SessionRepository;

  beforeAll(() => {
    testApiKey = createTestApiKey();
    mockRepo = createMockRepository({
      getRecentSessions: () => [sampleSession, heartbeatSession],
      getManualSessions: () => [sampleSession],
      getAutomaticSessions: () => [heartbeatSession],
      getSessionById: (id: string) => {
        if (id === 'test-session-1') return sampleSession;
        if (id === 'test-heartbeat-session') return heartbeatSession;
        return undefined;
      },
      getMessagesBySessionId: (sessionId: string) => {
        if (sessionId === 'test-session-1') return sampleMessages;
        return [];
      },
      searchMessages: () => sampleSearchResults,
    });
    app = createTestApp({ repo: mockRepo }, true);
  });

  afterAll(() => {
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
    it('should return paginated sessions from repository', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toBeInstanceOf(Array);
      expect(res.body.sessions.length).toBe(2);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.offset).toBe(0);
    });

    it('should transform is_automatic to isAutomatic', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);

      expect(res.body.sessions[0].isAutomatic).toBe(false);
      expect(res.body.sessions[1].isAutomatic).toBe(true);
    });

    it('should transform is_unread to isUnread', async () => {
      const res = await request(app)
        .get('/sessions')
        .set('X-API-Key', testApiKey);

      expect(res.body.sessions[0].isUnread).toBe(false);
      expect(res.body.sessions[1].isUnread).toBe(true);
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

    it('should call getAutomaticSessions when automatic=true', async () => {
      const res = await request(app)
        .get('/sessions?automatic=true')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].isAutomatic).toBe(true);
    });

    it('should call getManualSessions when automatic=false', async () => {
      const res = await request(app)
        .get('/sessions?automatic=false')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.sessions.length).toBe(1);
      expect(res.body.sessions[0].isAutomatic).toBe(false);
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
      expect(res.body.session.isAutomatic).toBe(false);
      expect(res.body.messages).toBeInstanceOf(Array);
      expect(res.body.messages.length).toBe(2);
      expect(res.body.messages[0].uuid).toBe('msg-001');
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
    it('should return search results from repository', async () => {
      const res = await request(app)
        .get('/search?q=react')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(200);
      expect(res.body.results).toBeInstanceOf(Array);
      expect(res.body.results.length).toBe(1);
      expect(res.body.results[0].sessionId).toBe('test-session-1');
      expect(res.body.results[0].message.highlightedContent).toContain('<mark>');
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

    it('should return 400 for query with only special characters', async () => {
      const res = await request(app)
        .get("/search?q='\"*()")
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid search query');
    });

    it('should call searchMessages with sanitized query', async () => {
      const searchSpy = jest.fn().mockReturnValue(sampleSearchResults);
      const spyRepo = createMockRepository({ searchMessages: searchSpy as SessionRepository['searchMessages'] });
      const spyApp = createTestApp({ repo: spyRepo }, false);

      await request(spyApp).get('/search?q=hello+world');

      expect(searchSpy).toHaveBeenCalled();
      const [query] = searchSpy.mock.calls[0];
      // Query should have * suffix for prefix matching
      expect(query).toBe('hello* world*');
    });
  });

  describe('DELETE /sessions/:id', () => {
    it('should call hideSession on repository', async () => {
      const hideSpy = jest.fn();
      const spyRepo = createMockRepository({
        getSessionById: () => sampleSession,
        hideSession: hideSpy,
      });
      const spyApp = createTestApp({ repo: spyRepo }, false);

      const res = await request(spyApp).delete('/sessions/test-session-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(hideSpy).toHaveBeenCalledWith('test-session-1');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request(app)
        .delete('/sessions/not-found')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });

  describe('POST /sessions/:id/read', () => {
    it('should call markSessionAsRead on repository', async () => {
      const readSpy = jest.fn();
      const spyRepo = createMockRepository({
        getSessionById: () => heartbeatSession,
        markSessionAsRead: readSpy,
      });
      const spyApp = createTestApp({ repo: spyRepo }, false);

      const res = await request(spyApp).post('/sessions/test-heartbeat-session/read');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(readSpy).toHaveBeenCalledWith('test-heartbeat-session');
    });

    it('should return 404 for non-existent session', async () => {
      const res = await request(app)
        .post('/sessions/not-found/read')
        .set('X-API-Key', testApiKey);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Session not found');
    });
  });
});

describe('API without authentication configured', () => {
  let app: Application;

  beforeAll(() => {
    removeTestApiKey();
    const repo = createMockRepository({
      getRecentSessions: () => [sampleSession],
    });
    app = createTestApp({ repo }, true);
  });

  it('should allow requests when no API key is configured', async () => {
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBe(1);
  });
});

describe('POST /heartbeat', () => {
  const mockRepo = createMockRepository();

  it('should return 503 when heartbeatService not provided', async () => {
    const app = createTestApp({ repo: mockRepo }, false);
    const res = await request(app).post('/heartbeat');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Heartbeat service not initialized');
  });

  it('should call runHeartbeat(true) and return result', async () => {
    const mockResult = { tasksProcessed: 1, sessionsCreated: 0, sessionIds: [], errors: [] };
    const mockHeartbeat = { runHeartbeat: jest.fn().mockResolvedValue(mockResult) };
    const app = createTestApp({
      repo: mockRepo,
      heartbeatService: mockHeartbeat as unknown as import('../src/services/HeartbeatService.js').HeartbeatService,
    }, false);

    const res = await request(app).post('/heartbeat');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockResult);
    expect(mockHeartbeat.runHeartbeat).toHaveBeenCalledWith(true);
  });
});

describe('GET /api/config', () => {
  const mockRepo = createMockRepository();

  it('should return 503 when configService not provided', async () => {
    const app = createTestApp({ repo: mockRepo }, false);
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should return sections when configService provided', async () => {
    const mockSections = { heartbeat: { enabled: false }, security: { allowedWorkingDirs: [] } };
    const mockConfig = { getAllEditableSections: jest.fn().mockReturnValue(mockSections) };
    const app = createTestApp({
      repo: mockRepo,
      configService: mockConfig as unknown as import('../src/services/ConfigService.js').ConfigService,
    }, false);

    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockSections);
  });
});

describe('PUT /api/config/:section', () => {
  const mockRepo = createMockRepository();

  it('should return 503 when configService not provided', async () => {
    const app = createTestApp({ repo: mockRepo }, false);
    const res = await request(app).put('/api/config/heartbeat').send({ enabled: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should update section and call onConfigChanged callback', async () => {
    const onChanged = jest.fn();
    const mockConfig = { updateSection: jest.fn().mockReturnValue(null) };
    const app = createTestApp({
      repo: mockRepo,
      configService: mockConfig as unknown as import('../src/services/ConfigService.js').ConfigService,
      onConfigChanged: onChanged,
    }, false);

    const res = await request(app).put('/api/config/heartbeat').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockConfig.updateSection).toHaveBeenCalledWith('heartbeat', { enabled: true });
    expect(onChanged).toHaveBeenCalledWith('heartbeat');
  });

  it('should return 400 for validation error', async () => {
    const mockConfig = { updateSection: jest.fn().mockReturnValue('intervalMs must be >= 60000') };
    const app = createTestApp({
      repo: mockRepo,
      configService: mockConfig as unknown as import('../src/services/ConfigService.js').ConfigService,
    }, false);

    const res = await request(app).put('/api/config/heartbeat').send({ intervalMs: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('intervalMs must be >= 60000');
  });
});

describe('POST /reindex', () => {
  const mockRepo = createMockRepository();

  it('should call indexFn and return result with force=false by default', async () => {
    const indexFn = jest.fn<() => Promise<{ indexed: number; skipped: number }>>()
      .mockResolvedValue({ indexed: 5, skipped: 10 });
    const app = createTestApp({ repo: mockRepo, indexFn }, false);

    const res = await request(app).post('/reindex');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, indexed: 5, skipped: 10 });
    expect(indexFn).toHaveBeenCalledWith(false, mockRepo, expect.anything());
  });

  it('should pass force=true when ?force=true', async () => {
    const indexFn = jest.fn<() => Promise<{ indexed: number; skipped: number }>>()
      .mockResolvedValue({ indexed: 0, skipped: 0 });
    const app = createTestApp({ repo: mockRepo, indexFn }, false);

    await request(app).post('/reindex?force=true');

    expect(indexFn).toHaveBeenCalledWith(true, mockRepo, expect.anything());
  });

  it('should return 500 when indexFn rejects', async () => {
    const indexFn = jest.fn<() => Promise<{ indexed: number; skipped: number }>>()
      .mockRejectedValue(new Error('disk full'));
    const app = createTestApp({ repo: mockRepo, indexFn }, false);

    const res = await request(app).post('/reindex');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Reindex failed');
  });
});

describe('GET /heartbeat/status', () => {
  const mockRepo = createMockRepository();

  it('should return defaults when heartbeatService not provided', async () => {
    const app = createTestApp({ repo: mockRepo }, false);

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      intervalMs: 0,
      workingDirectory: '',
      state: [],
    });
  });

  it('should return mapped state from heartbeatService', async () => {
    const mockHeartbeat = {
      getAllState: jest.fn().mockReturnValue([
        { key: 'item-1', last_changed: '2025-01-01', last_processed: '2025-01-01' },
      ]),
      getConfig: jest.fn().mockReturnValue({
        enabled: true,
        intervalMs: 120000,
        workingDirectory: '/tmp/work',
      }),
    };
    const app = createTestApp({
      repo: mockRepo,
      heartbeatService: mockHeartbeat as unknown as import('../src/services/HeartbeatService.js').HeartbeatService,
    }, false);

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.intervalMs).toBe(120000);
    expect(res.body.workingDirectory).toBe('/tmp/work');
    expect(res.body.state).toEqual([
      { key: 'item-1', lastChanged: '2025-01-01', lastProcessed: '2025-01-01' },
    ]);
  });

  it('should return 500 when getAllState throws', async () => {
    const mockHeartbeat = {
      getAllState: jest.fn().mockImplementation(() => { throw new Error('db error'); }),
      getConfig: jest.fn().mockReturnValue({ enabled: false, intervalMs: 0, workingDirectory: '' }),
    };
    const app = createTestApp({
      repo: mockRepo,
      heartbeatService: mockHeartbeat as unknown as import('../src/services/HeartbeatService.js').HeartbeatService,
    }, false);

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to get heartbeat status');
  });
});

describe('GET /admin', () => {
  const mockRepo = createMockRepository();

  it('should return HTML content type', async () => {
    const app = createTestApp({ repo: mockRepo }, false);

    const res = await request(app).get('/admin');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('should return valid HTML document', async () => {
    const app = createTestApp({ repo: mockRepo }, false);

    const res = await request(app).get('/admin');

    expect(res.text).toContain('<!DOCTYPE html>');
  });
});

describe('GET /api/config/:section', () => {
  const mockRepo = createMockRepository();

  it('should return 503 when configService not provided', async () => {
    const app = createTestApp({ repo: mockRepo }, false);

    const res = await request(app).get('/api/config/heartbeat');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should return section data when found', async () => {
    const sectionData = { enabled: true, intervalMs: 120000 };
    const mockConfig = { getSection: jest.fn().mockReturnValue(sectionData) };
    const app = createTestApp({
      repo: mockRepo,
      configService: mockConfig as unknown as import('../src/services/ConfigService.js').ConfigService,
    }, false);

    const res = await request(app).get('/api/config/heartbeat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sectionData);
    expect(mockConfig.getSection).toHaveBeenCalledWith('heartbeat');
  });

  it('should return 404 for unknown section', async () => {
    const mockConfig = { getSection: jest.fn().mockReturnValue(null) };
    const app = createTestApp({
      repo: mockRepo,
      configService: mockConfig as unknown as import('../src/services/ConfigService.js').ConfigService,
    }, false);

    const res = await request(app).get('/api/config/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Unknown section: nonexistent');
  });
});
