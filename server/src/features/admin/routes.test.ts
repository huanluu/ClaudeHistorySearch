import request from 'supertest';
import express, { type Application } from 'express';
import { Router } from 'express';
import { registerAdminRoutes, type AdminRouteDeps } from './index';
import type { ConfigService } from './ConfigService';
import type { DiagnosticsService } from './DiagnosticsService';
import { noopLogger } from '../../../tests/__helpers/index';

function createAdminApp(deps: {
  diagnosticsService?: AdminRouteDeps['diagnosticsService'];
  configService?: AdminRouteDeps['configService'];
  onConfigChanged?: (section: string) => void;
  adminHtml?: string;
}): Application {
  const app = express();
  app.use(express.json());

  const router = Router();
  registerAdminRoutes(router, {
    diagnosticsService: deps.diagnosticsService,
    configService: deps.configService,
    onConfigChanged: deps.onConfigChanged,
    logger: noopLogger,
    adminHtml: deps.adminHtml,
  });
  app.use('/', router);

  return app;
}

describe('GET /health', () => {
  it('should return health status without authentication', async () => {
    const app = createAdminApp({});

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toBeDefined();
  });

  it('health response matches contract schema', async () => {
    const app = createAdminApp({});

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(['healthy', 'degraded']).toContain(res.body.status);
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('should return enhanced health when diagnosticsService is provided', async () => {
    const mockDiagnostics = {
      getHealth: vi.fn().mockReturnValue({
        status: 'healthy',
        timestamp: '2025-01-01T00:00:00.000Z',
        checks: { database: true },
      }),
    };
    const app = createAdminApp({ diagnosticsService: mockDiagnostics as unknown as DiagnosticsService });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.checks.database).toBe(true);
  });

  it('should return degraded when database check fails', async () => {
    const mockDiagnostics = {
      getHealth: vi.fn().mockReturnValue({
        status: 'degraded',
        timestamp: '2025-01-01T00:00:00.000Z',
        checks: { database: false },
      }),
    };
    const app = createAdminApp({ diagnosticsService: mockDiagnostics as unknown as DiagnosticsService });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.database).toBe(false);
  });
});

describe('GET /diagnostics', () => {
  it('should return 503 when diagnosticsService not provided', async () => {
    const app = createAdminApp({});
    const res = await request(app).get('/diagnostics');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Diagnostics service not initialized');
  });

  it('should return full diagnostics snapshot', async () => {
    const mockDiagnostics = {
      getDiagnostics: vi.fn().mockReturnValue({
        status: 'healthy',
        uptime: { startedAt: '2025-01-01T00:00:00.000Z', uptimeSeconds: 3600 },
        database: { connected: true, path: '/tmp/test.db', sessionCount: 50, messageCount: 1000, dbSizeBytes: 512000 },
        indexer: { watcherActive: true, lastRunAt: '2025-01-01T01:00:00.000Z', lastRunResult: { indexed: 5, skipped: 45 } },
        websocket: { activeConnections: 2, activeSessions: 1 },
        heartbeat: { enabled: true, schedulerActive: true },
        recentErrors: [],
        errorCount: { last1h: 0, last24h: 0 },
      }),
    };
    const app = createAdminApp({ diagnosticsService: mockDiagnostics as unknown as DiagnosticsService });

    const res = await request(app).get('/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.uptime.uptimeSeconds).toBe(3600);
    expect(res.body.database.connected).toBe(true);
    expect(res.body.indexer.watcherActive).toBe(true);
    expect(res.body.websocket.activeConnections).toBe(2);
    expect(res.body.heartbeat.enabled).toBe(true);
  });

  it('should return 503 when status is unhealthy', async () => {
    const mockDiagnostics = {
      getDiagnostics: vi.fn().mockReturnValue({
        status: 'unhealthy',
        uptime: { startedAt: '2025-01-01T00:00:00.000Z', uptimeSeconds: 100 },
        database: { connected: false, path: '/tmp/test.db', sessionCount: 0, messageCount: 0, dbSizeBytes: 0 },
        indexer: { watcherActive: false, lastRunAt: null, lastRunResult: null },
        websocket: { activeConnections: 0, activeSessions: 0 },
        heartbeat: { enabled: false, schedulerActive: false },
        recentErrors: [{ timestamp: '2025-01-01T00:00:00.000Z', message: 'DB down' }],
        errorCount: { last1h: 5, last24h: 20 },
      }),
    };
    const app = createAdminApp({ diagnosticsService: mockDiagnostics as unknown as DiagnosticsService });

    const res = await request(app).get('/diagnostics');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.database.connected).toBe(false);
  });
});

describe('GET /admin', () => {
  it('should return HTML content type', async () => {
    const app = createAdminApp({ adminHtml: '<!DOCTYPE html><html></html>' });

    const res = await request(app).get('/admin');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('should return valid HTML document', async () => {
    const app = createAdminApp({ adminHtml: '<!DOCTYPE html><html><body>Admin</body></html>' });

    const res = await request(app).get('/admin');

    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('should return 503 when adminHtml not provided', async () => {
    const app = createAdminApp({});

    const res = await request(app).get('/admin');

    expect(res.status).toBe(503);
  });
});

describe('GET /api/config', () => {
  it('should return 503 when configService not provided', async () => {
    const app = createAdminApp({});
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should return sections when configService provided', async () => {
    const mockSections = { heartbeat: { enabled: false }, security: { allowedWorkingDirs: [] } };
    const mockConfig = { getAllEditableSections: vi.fn().mockReturnValue(mockSections) };
    const app = createAdminApp({ configService: mockConfig as unknown as ConfigService });

    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockSections);
  });
});

describe('GET /api/config/:section', () => {
  it('should return 503 when configService not provided', async () => {
    const app = createAdminApp({});

    const res = await request(app).get('/api/config/heartbeat');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should return section data when found', async () => {
    const sectionData = { enabled: true, intervalMs: 120000 };
    const mockConfig = { getSection: vi.fn().mockReturnValue(sectionData) };
    const app = createAdminApp({ configService: mockConfig as unknown as ConfigService });

    const res = await request(app).get('/api/config/heartbeat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sectionData);
    expect(mockConfig.getSection).toHaveBeenCalledWith('heartbeat');
  });

  it('should return 404 for unknown section', async () => {
    const mockConfig = { getSection: vi.fn().mockReturnValue(null) };
    const app = createAdminApp({ configService: mockConfig as unknown as ConfigService });

    const res = await request(app).get('/api/config/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Unknown section: nonexistent');
  });
});

describe('PUT /api/config/:section', () => {
  it('should return 503 when configService not provided', async () => {
    const app = createAdminApp({});
    const res = await request(app).put('/api/config/heartbeat').send({ enabled: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Config service not initialized');
  });

  it('should update section and call onConfigChanged callback', async () => {
    const onChanged = vi.fn();
    const mockConfig = { updateSection: vi.fn().mockReturnValue(null) };
    const app = createAdminApp({
      configService: mockConfig as unknown as ConfigService,
      onConfigChanged: onChanged,
    });

    const res = await request(app).put('/api/config/heartbeat').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockConfig.updateSection).toHaveBeenCalledWith('heartbeat', { enabled: true });
    expect(onChanged).toHaveBeenCalledWith('heartbeat');
  });

  it('should return 400 for validation error', async () => {
    const mockConfig = { updateSection: vi.fn().mockReturnValue('intervalMs must be >= 60000') };
    const app = createAdminApp({ configService: mockConfig as unknown as ConfigService });

    const res = await request(app).put('/api/config/heartbeat').send({ intervalMs: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('intervalMs must be >= 60000');
  });
});
