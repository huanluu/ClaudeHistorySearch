import Bonjour from 'bonjour-service';
import { execSync } from 'child_process';
import { Router } from 'express';
import { createDatabase, createSessionRepository, createHeartbeatRepository, DB_PATH } from './shared/infra/database/index';
import { authMiddleware, hasApiKey, WorkingDirValidator, createLogger, LOG_PATH, ErrorRingBuffer, createRequestLogger, type RequestLogLevel, type RequestLoggerOptions, type SessionSource } from './shared/provider/index';
import { HttpTransport, WebSocketGateway, validateQuery, validateBody, SearchQuerySchema, SessionsQuerySchema, ConfigUpdateBodySchema } from './gateway/index';
import type { AuthenticatedClient } from './gateway/index';
import { AgentStore, registerLiveHandlers } from './features/live/index';
import { AgentExecutor } from './shared/infra/runtime/index';
import { indexAllSessions, FileWatcher, registerSearchRoutes } from './features/search/index';
import { ClaudeSessionSource, CopilotSessionSource } from './shared/infra/parsers/index';
import { HeartbeatService, type HeartbeatConfig, registerSchedulerRoutes } from './features/scheduler/index';
import { ConfigService, DiagnosticsService, registerAdminRoutes } from './features/admin/index';

export interface AppConfig {
  port: number;
  serviceType?: string;
  dbPath?: string;
  logPath?: string;
  skipBonjour?: boolean;
  sessionSources?: SessionSource[];
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  getPort(): number;
  getHttpTransport(): HttpTransport;
}

/**
 * Check if macOS firewall stealth mode is enabled (blocks Bonjour discovery)
 */
function isStealthModeEnabled(): boolean {
  try {
    const output = execSync('/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.includes('stealth mode is on');
  } catch {
    return false;
  }
}

/**
 * Composition root: wires all services together and returns an App
 * with start/stop lifecycle control.
 */
export function createApp(config: AppConfig): App {
  const { port, serviceType = 'claudehistory' } = config;
  const dbPath = config.dbPath ?? DB_PATH;
  const logPath = config.logPath ?? LOG_PATH;

  // --- Logger with error ring buffer ---
  const errorBuffer = new ErrorRingBuffer(50);
  const logger = createLogger(logPath, { errorBuffer });

  // --- Database ---
  const db = createDatabase(dbPath, logger);

  // --- Repositories ---
  const sessionRepo = createSessionRepository(db);
  const heartbeatRepo = createHeartbeatRepository(db);

  // --- Services ---
  const configService = new ConfigService();
  const securityConfig = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
  const allowedDirs = securityConfig?.allowedWorkingDirs ?? [];
  const workingDirValidator = new WorkingDirValidator(allowedDirs);
  const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo, logger);

  // --- Session sources (multi-agent) ---
  const sessionSources = config.sessionSources ?? [new ClaudeSessionSource(), new CopilotSessionSource()];
  const fileWatcher = new FileWatcher(sessionSources, sessionRepo, logger);
  const agentStore = new AgentStore(logger, (id, log) => new AgentExecutor(id, log));

  // --- Diagnostics ---
  const startedAt = new Date();
  let wsGateway: WebSocketGateway | null = null;
  const diagnosticsService = new DiagnosticsService({
    repo: sessionRepo,
    errorBuffer,
    fileWatcher,
    heartbeatService,
    getWsClientCount: () => wsGateway?.getClientCount() ?? 0,
    getActiveSessionCount: () => agentStore.getAll().length,
    startedAt,
    dbPath,
  });

  // --- Request logging ---
  const loggingConfig = configService.getSection('logging') as { requestLogLevel?: string } | null;
  const requestLoggerOptions: RequestLoggerOptions = {
    level: (loggingConfig?.requestLogLevel as RequestLogLevel) ?? 'all',
    logger,
  };

  // --- HTTP Transport (middleware order matters: logger → auth → routes) ---
  const transport = new HttpTransport({ port });
  transport.use(createRequestLogger(requestLoggerOptions));
  transport.use(authMiddleware);

  let bonjour: Bonjour | null = null;
  let service: ReturnType<Bonjour['publish']> | null = null;
  let reindexTimer: NodeJS.Timeout | null = null;

  // --- Config hot-reload ---
  const onConfigChanged = (section: string): void => {
    if (section === 'heartbeat') {
      const updatedSection = configService.getSection('heartbeat');
      if (updatedSection) {
        heartbeatService.updateConfig(updatedSection as Partial<HeartbeatConfig>);
      }
      heartbeatService.startScheduler();
    }
    if (section === 'logging') {
      const updatedLogging = configService.getSection('logging') as { requestLogLevel?: string } | null;
      requestLoggerOptions.level = (updatedLogging?.requestLogLevel as RequestLogLevel) ?? 'all';
      logger.log({ msg: `Request log level updated: ${requestLoggerOptions.level}`, op: 'server.config' });
    }
    if (section === 'security') {
      const updatedSecurity = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
      const updatedDirs = updatedSecurity?.allowedWorkingDirs ?? [];
      workingDirValidator.setAllowedDirs(updatedDirs);
      logger.log({ msg: `Security config updated: ${updatedDirs.length} allowed working director${updatedDirs.length === 1 ? 'y' : 'ies'}`, op: 'server.config', context: { allowedDirs: updatedDirs.length } });
    }
  };

  // --- HTTP Validation Middleware (gateway layer validates before features handle) ---
  const validationRouter = Router();
  validationRouter.get('/search', validateQuery(SearchQuerySchema));
  validationRouter.get('/sessions', validateQuery(SessionsQuerySchema));
  validationRouter.put('/api/config/:section', validateBody(ConfigUpdateBodySchema));
  transport.use('/', validationRouter);

  // --- HTTP Routes ---
  const router = Router();
  registerSearchRoutes(router, {
    repo: sessionRepo,
    logger,
    indexFn: (force, repo, logger) => indexAllSessions(force, repo, logger, sessionSources),
  });
  registerSchedulerRoutes(router, { heartbeatService, logger });
  registerAdminRoutes(router, { diagnosticsService, configService, onConfigChanged, logger });
  transport.use('/', router);

  // --- Lifecycle ---
  async function start(): Promise<void> {
    // Security logging
    if (allowedDirs.length === 0) {
      logger.log({ msg: 'WARNING: No allowed working directories configured. All session.start/resume requests will be denied.', op: 'server.start' });
      logger.log({ msg: 'Configure allowed directories via the admin UI at /admin', op: 'server.start' });
    } else {
      logger.log({ msg: `Security: ${allowedDirs.length} allowed working director${allowedDirs.length === 1 ? 'y' : 'ies'} configured`, op: 'server.start', context: { allowedDirs: allowedDirs.length } });
    }

    // Start HTTP server (router is fully wired before accepting requests)
    await transport.start();

    const boundPort = transport.getPort();
    logger.log({ msg: `Claude History Server running on http://0.0.0.0:${boundPort}`, op: 'server.start', context: { port: boundPort } });
    logger.log({ msg: `Database: ${dbPath}`, op: 'server.start', context: { dbPath } });

    // Initialize WebSocket gateway (attached to HTTP server AFTER it's listening)
    const httpServer = transport.getServer();
    if (httpServer) {
      wsGateway = new WebSocketGateway({
        server: httpServer,
        path: '/ws',
        pingInterval: 30000,
        logger,
      });

      // Register feature handlers with gateway
      registerLiveHandlers(wsGateway, {
        agentStore,
        validator: workingDirValidator,
        logger,
      });

      // Connection logging
      wsGateway.onConnect((client: AuthenticatedClient) => {
        logger.log({ msg: `Client connected: ${client.clientId} (${wsGateway?.getClientCount()} total)`, op: 'ws.connect', context: { clientId: client.clientId, total: wsGateway?.getClientCount() } });
      });
      wsGateway.onDisconnect((client: AuthenticatedClient) => {
        logger.log({ msg: `Client disconnected: ${client.clientId} (${wsGateway?.getClientCount()} total)`, op: 'ws.disconnect', context: { clientId: client.clientId, total: wsGateway?.getClientCount() } });
      });

      // Fallback handler for 'message' type (echo)
      wsGateway.on('message', (client, payload, id) => {
        logger.log({ msg: `Message from ${client.clientId}`, op: 'ws.message', context: { clientId: client.clientId } });
        client.send({
          type: 'message',
          payload: { echo: payload },
          id,
        });
      });

      wsGateway.start();
      logger.log({ msg: `WebSocket server available at ws://0.0.0.0:${boundPort}/ws`, op: 'server.start', context: { port: boundPort } });
    }

    // API key status
    if (hasApiKey()) {
      logger.log({ msg: 'Authentication: API key required', op: 'server.start' });
    } else {
      logger.log({ msg: 'Authentication: No API key configured (run "npm run key:generate" to secure the server)', op: 'server.start' });
    }

    // Initial indexing
    logger.log({ msg: 'Starting initial index...', op: 'server.start' });
    const result = await indexAllSessions(false, sessionRepo, logger, sessionSources);
    diagnosticsService.setLastIndexResult(result);
    logger.log({ msg: `Initial index complete: ${result.indexed} sessions indexed`, op: 'server.start', context: { indexed: result.indexed } });

    // Bonjour advertisement (auto-disabled if stealth mode is on or skipBonjour is set)
    if (config.skipBonjour) {
      logger.log({ msg: 'Bonjour advertisement skipped (skipBonjour option)', op: 'server.start' });
    } else {
      const stealthMode = isStealthModeEnabled();
      if (stealthMode) {
        logger.log({ msg: 'Bonjour advertisement disabled (firewall stealth mode is on)', op: 'server.start' });
      } else {
        bonjour = new Bonjour();
        service = bonjour.publish({
          name: 'Claude History Server',
          type: serviceType,
          port: boundPort,
          txt: { version: '1.0.0' }
        });
        logger.log({ msg: `Bonjour service advertised as _${serviceType}._tcp on port ${boundPort}`, op: 'server.start', context: { serviceType, port: boundPort } });
      }
    }

    // File watcher
    fileWatcher.start();

    // Periodic reindex
    const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
    reindexTimer = setInterval(async () => {
      logger.log({ msg: 'Running periodic reindex...', op: 'server.reindex' });
      const reindexResult = await indexAllSessions(false, sessionRepo, logger, sessionSources);
      diagnosticsService.setLastIndexResult(reindexResult);
      if (reindexResult.indexed > 0) {
        logger.log({ msg: `Periodic reindex: ${reindexResult.indexed} new sessions indexed`, op: 'server.reindex', context: { indexed: reindexResult.indexed } });
      } else {
        logger.log({ msg: 'Periodic reindex: no new sessions', op: 'server.reindex' });
      }
    }, REINDEX_INTERVAL);
    logger.log({ msg: `Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes`, op: 'server.start', context: { intervalMinutes: REINDEX_INTERVAL / 1000 / 60 } });

    // Heartbeat scheduler
    const heartbeatConfig = heartbeatService.getConfig();
    if (heartbeatConfig.enabled) {
      heartbeatService.startScheduler();
      logger.log({ msg: `Heartbeat working directory: ${heartbeatConfig.workingDirectory}`, op: 'server.start', context: { workingDirectory: heartbeatConfig.workingDirectory } });
    } else {
      logger.log({ msg: 'Heartbeat: disabled', op: 'server.start' });
    }
  }

  async function stop(): Promise<void> {
    logger.log({ msg: 'Shutting down...', op: 'server.stop' });
    if (reindexTimer) {
      clearInterval(reindexTimer);
      reindexTimer = null;
    }
    heartbeatService.stopScheduler();
    service?.stop?.();
    bonjour?.destroy();
    await fileWatcher.stop();
    await wsGateway?.stop();
    await transport.stop();
    logger.log({ msg: 'Server stopped', op: 'server.stop' });
  }

  return {
    start,
    stop,
    getPort: () => transport.getPort(),
    getHttpTransport: () => transport,
  };
}
