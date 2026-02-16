import { jest } from '@jest/globals';
import { ErrorRingBuffer } from '../src/provider/index.js';
import { DiagnosticsService } from '../src/services/DiagnosticsService.js';
import type { DiagnosticsSources } from '../src/services/DiagnosticsService.js';
import type { SessionRepository, DatabaseStats } from '../src/database/index.js';
import type { FileWatcher } from '../src/services/FileWatcher.js';
import type { HeartbeatService } from '../src/services/HeartbeatService.js';

function createMockSources(overrides?: Partial<DiagnosticsSources>): DiagnosticsSources {
  const mockRepo = {
    getStats: jest.fn<(dbPath: string) => DatabaseStats>().mockReturnValue({
      sessionCount: 100,
      messageCount: 5000,
      dbSizeBytes: 1024 * 1024,
    }),
    getRecentSessions: jest.fn(),
    getManualSessions: jest.fn(),
    getAutomaticSessions: jest.fn(),
    getSessionById: jest.fn(),
    getMessagesBySessionId: jest.fn(),
    searchMessages: jest.fn(),
    markSessionAsRead: jest.fn(),
    hideSession: jest.fn(),
    getSessionLastIndexed: jest.fn(),
    indexSession: jest.fn(),
  } as unknown as SessionRepository;

  const mockFileWatcher = {
    isActive: jest.fn<() => boolean>().mockReturnValue(true),
    start: jest.fn(),
    stop: jest.fn(),
  } as unknown as FileWatcher;

  const mockHeartbeat = {
    getConfig: jest.fn().mockReturnValue({ enabled: true }),
    isSchedulerActive: jest.fn<() => boolean>().mockReturnValue(true),
  } as unknown as HeartbeatService;

  return {
    repo: mockRepo,
    errorBuffer: new ErrorRingBuffer(50),
    fileWatcher: mockFileWatcher,
    heartbeatService: mockHeartbeat,
    getWsClientCount: () => 3,
    getActiveSessionCount: () => 1,
    startedAt: new Date(Date.now() - 60000), // started 1 min ago
    dbPath: '/tmp/test.db',
    ...overrides,
  };
}

describe('DiagnosticsService', () => {
  describe('getHealth()', () => {
    it('returns healthy when database is reachable', () => {
      const sources = createMockSources();
      const service = new DiagnosticsService(sources);

      const health = service.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.checks.database).toBe(true);
      expect(health.timestamp).toBeDefined();
    });

    it('returns degraded when database throws', () => {
      const sources = createMockSources();
      (sources.repo.getStats as jest.Mock).mockImplementation(() => {
        throw new Error('SQLITE_BUSY');
      });
      const service = new DiagnosticsService(sources);

      const health = service.getHealth();
      expect(health.status).toBe('degraded');
      expect(health.checks.database).toBe(false);
    });
  });

  describe('getDiagnostics()', () => {
    it('returns full healthy snapshot', () => {
      const sources = createMockSources();
      const service = new DiagnosticsService(sources);
      service.setLastIndexResult({ indexed: 42, skipped: 10 });

      const diag = service.getDiagnostics();

      expect(diag.status).toBe('healthy');
      expect(diag.uptime.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(diag.database.connected).toBe(true);
      expect(diag.database.sessionCount).toBe(100);
      expect(diag.database.messageCount).toBe(5000);
      expect(diag.database.dbSizeBytes).toBe(1024 * 1024);
      expect(diag.indexer.watcherActive).toBe(true);
      expect(diag.indexer.lastRunResult).toEqual({ indexed: 42, skipped: 10 });
      expect(diag.websocket.activeConnections).toBe(3);
      expect(diag.websocket.activeSessions).toBe(1);
      expect(diag.heartbeat.enabled).toBe(true);
      expect(diag.heartbeat.schedulerActive).toBe(true);
      expect(diag.recentErrors).toEqual([]);
      expect(diag.errorCount.last1h).toBe(0);
      expect(diag.errorCount.last24h).toBe(0);
    });

    it('returns unhealthy when database throws', () => {
      const sources = createMockSources();
      (sources.repo.getStats as jest.Mock).mockImplementation(() => {
        throw new Error('SQLITE_BUSY');
      });
      const service = new DiagnosticsService(sources);

      const diag = service.getDiagnostics();
      expect(diag.status).toBe('unhealthy');
      expect(diag.database.connected).toBe(false);
      expect(diag.database.sessionCount).toBe(0);
    });

    it('calculates correct uptime', () => {
      const startedAt = new Date(Date.now() - 120_000); // 2 min ago
      const sources = createMockSources({ startedAt });
      const service = new DiagnosticsService(sources);

      const diag = service.getDiagnostics();
      // Allow 1 second tolerance
      expect(diag.uptime.uptimeSeconds).toBeGreaterThanOrEqual(119);
      expect(diag.uptime.uptimeSeconds).toBeLessThanOrEqual(121);
    });

    it('includes recent errors from error buffer', () => {
      const sources = createMockSources();
      sources.errorBuffer.push({
        timestamp: new Date().toISOString(),
        op: 'db.query',
        errType: 'db_error',
        message: 'SQLITE_BUSY',
      });
      const service = new DiagnosticsService(sources);

      const diag = service.getDiagnostics();
      expect(diag.recentErrors).toHaveLength(1);
      expect(diag.recentErrors[0].message).toBe('SQLITE_BUSY');
      expect(diag.errorCount.last1h).toBe(1);
      expect(diag.errorCount.last24h).toBe(1);
    });

    it('handles missing heartbeatService gracefully', () => {
      const sources = createMockSources({ heartbeatService: undefined });
      const service = new DiagnosticsService(sources);

      const diag = service.getDiagnostics();
      expect(diag.heartbeat.enabled).toBe(false);
      expect(diag.heartbeat.schedulerActive).toBe(false);
    });

    it('returns null lastRunAt/lastRunResult before any index runs', () => {
      const sources = createMockSources();
      const service = new DiagnosticsService(sources);

      const diag = service.getDiagnostics();
      expect(diag.indexer.lastRunAt).toBeNull();
      expect(diag.indexer.lastRunResult).toBeNull();
    });
  });
});
