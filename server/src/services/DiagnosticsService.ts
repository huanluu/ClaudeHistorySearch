import type { SessionRepository, DatabaseStats } from '../database/index.js';
import type { ErrorRingBuffer } from '../provider/index.js';
import type { FileWatcher } from './FileWatcher.js';
import type { HeartbeatService } from './HeartbeatService.js';

export interface DiagnosticsSources {
  repo: SessionRepository;
  errorBuffer: ErrorRingBuffer;
  fileWatcher: FileWatcher;
  heartbeatService?: HeartbeatService;
  getWsClientCount: () => number;
  getActiveSessionCount: () => number;
  startedAt: Date;
  dbPath: string;
}

export interface HealthResult {
  status: 'healthy' | 'degraded';
  timestamp: string;
  checks: {
    database: boolean;
  };
}

export interface DiagnosticsResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: {
    startedAt: string;
    uptimeSeconds: number;
  };
  database: {
    connected: boolean;
    path: string;
    sessionCount: number;
    messageCount: number;
    dbSizeBytes: number;
  };
  indexer: {
    watcherActive: boolean;
    lastRunAt: string | null;
    lastRunResult: { indexed: number; skipped: number } | null;
  };
  websocket: {
    activeConnections: number;
    activeSessions: number;
  };
  heartbeat: {
    enabled: boolean;
    schedulerActive: boolean;
  };
  recentErrors: Array<{
    timestamp: string;
    op?: string;
    errType?: string;
    message: string;
  }>;
  errorCount: {
    last1h: number;
    last24h: number;
  };
}

export class DiagnosticsService {
  private readonly sources: DiagnosticsSources;
  private lastIndexAt: string | null = null;
  private lastIndexResult: { indexed: number; skipped: number } | null = null;

  constructor(sources: DiagnosticsSources) {
    this.sources = sources;
  }

  setLastIndexResult(result: { indexed: number; skipped: number }): void {
    this.lastIndexAt = new Date().toISOString();
    this.lastIndexResult = result;
  }

  getHealth(): HealthResult {
    let dbConnected = true;
    try {
      this.sources.repo.getStats(this.sources.dbPath);
    } catch {
      dbConnected = false;
    }

    return {
      status: dbConnected ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbConnected,
      },
    };
  }

  getDiagnostics(): DiagnosticsResult {
    let dbConnected = true;
    let stats: DatabaseStats = { sessionCount: 0, messageCount: 0, dbSizeBytes: 0 };
    try {
      stats = this.sources.repo.getStats(this.sources.dbPath);
    } catch {
      dbConnected = false;
    }

    const now = new Date();
    const uptimeSeconds = Math.floor((now.getTime() - this.sources.startedAt.getTime()) / 1000);

    const heartbeatConfig = this.sources.heartbeatService?.getConfig();

    const recentErrors = this.sources.errorBuffer.getRecent(20);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const status = !dbConnected ? 'unhealthy' as const : 'healthy' as const;

    return {
      status,
      uptime: {
        startedAt: this.sources.startedAt.toISOString(),
        uptimeSeconds,
      },
      database: {
        connected: dbConnected,
        path: this.sources.dbPath,
        sessionCount: stats.sessionCount,
        messageCount: stats.messageCount,
        dbSizeBytes: stats.dbSizeBytes,
      },
      indexer: {
        watcherActive: this.sources.fileWatcher.isActive(),
        lastRunAt: this.lastIndexAt,
        lastRunResult: this.lastIndexResult,
      },
      websocket: {
        activeConnections: this.sources.getWsClientCount(),
        activeSessions: this.sources.getActiveSessionCount(),
      },
      heartbeat: {
        enabled: heartbeatConfig?.enabled ?? false,
        schedulerActive: this.sources.heartbeatService?.isSchedulerActive() ?? false,
      },
      recentErrors: recentErrors.map(e => ({
        timestamp: e.timestamp,
        op: e.op,
        errType: e.errType,
        message: e.message,
      })),
      errorCount: {
        last1h: this.sources.errorBuffer.countSince(oneHourAgo),
        last24h: this.sources.errorBuffer.countSince(twentyFourHoursAgo),
      },
    };
  }
}
