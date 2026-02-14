import Bonjour from 'bonjour-service';
import { execSync } from 'child_process';
import { createSessionRepository, createHeartbeatRepository, DB_PATH } from './database/index.js';
import { authMiddleware, hasApiKey, WorkingDirValidator, logger, createRequestLogger, type RequestLogLevel, type RequestLoggerOptions } from './provider/index.js';
import { HttpTransport, WebSocketTransport, type AuthenticatedWebSocket, type WSMessage } from './transport/index.js';
import { HeartbeatService, type HeartbeatConfig, ConfigService, FileWatcher, indexAllSessions, PROJECTS_DIR } from './services/index.js';
import { createRouter } from './api/index.js';

export interface AppConfig {
  port: number;
  serviceType?: string;
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

  // --- Repositories ---
  const sessionRepo = createSessionRepository();
  const heartbeatRepo = createHeartbeatRepository();

  // --- Services ---
  const configService = new ConfigService();
  const securityConfig = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
  const allowedDirs = securityConfig?.allowedWorkingDirs ?? [];
  const workingDirValidator = new WorkingDirValidator(allowedDirs);
  const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo, logger);
  const fileWatcher = new FileWatcher(PROJECTS_DIR, sessionRepo, logger);

  // --- Request logging ---
  const loggingConfig = configService.getSection('logging') as { requestLogLevel?: string } | null;
  const requestLoggerOptions: RequestLoggerOptions = {
    level: (loggingConfig?.requestLogLevel as RequestLogLevel) ?? 'all',
    logger,
  };

  // --- Transports ---
  const transport = new HttpTransport({ port });
  transport.use(createRequestLogger(requestLoggerOptions));
  transport.use(authMiddleware);

  let wsTransport: WebSocketTransport | null = null;
  let bonjour: Bonjour.default | null = null;
  let service: ReturnType<Bonjour.default['publish']> | null = null;
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

  // --- Router ---
  const router = createRouter({
    repo: sessionRepo,
    heartbeatService,
    configService,
    onConfigChanged,
    logger,
  });
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
    logger.log({ msg: `Database: ${DB_PATH}`, op: 'server.start', context: { dbPath: DB_PATH } });

    // Initialize WebSocket transport (attached to HTTP server)
    const httpServer = transport.getServer();
    if (httpServer) {
      wsTransport = new WebSocketTransport({
        server: httpServer,
        path: '/ws',
        pingInterval: 30000,
        validator: workingDirValidator,
        logger,
        onConnection: (ws: AuthenticatedWebSocket) => {
          logger.log({ msg: `Client connected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`, op: 'ws.connect', context: { clientId: ws.clientId, total: wsTransport?.getClientCount() } });
        },
        onDisconnection: (ws: AuthenticatedWebSocket) => {
          logger.log({ msg: `Client disconnected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`, op: 'ws.disconnect', context: { clientId: ws.clientId, total: wsTransport?.getClientCount() } });
        },
        onMessage: (ws: AuthenticatedWebSocket, message: WSMessage) => {
          logger.log({ msg: `Message from ${ws.clientId}: ${message.type}`, op: 'ws.message', context: { clientId: ws.clientId, type: message.type } });
          if (message.type === 'message') {
            wsTransport?.send(ws, {
              type: 'message',
              payload: { echo: message.payload },
              id: message.id
            });
          }
        }
      });
      wsTransport.start();
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
    const result = await indexAllSessions(false, sessionRepo, logger);
    logger.log({ msg: `Initial index complete: ${result.indexed} sessions indexed`, op: 'server.start', context: { indexed: result.indexed } });

    // Bonjour advertisement (auto-disabled if stealth mode is on)
    const stealthMode = isStealthModeEnabled();
    if (stealthMode) {
      logger.log({ msg: 'Bonjour advertisement disabled (firewall stealth mode is on)', op: 'server.start' });
    } else {
      bonjour = new Bonjour.default();
      service = bonjour.publish({
        name: 'Claude History Server',
        type: serviceType,
        port: boundPort,
        txt: { version: '1.0.0' }
      });
      logger.log({ msg: `Bonjour service advertised as _${serviceType}._tcp on port ${boundPort}`, op: 'server.start', context: { serviceType, port: boundPort } });
    }

    // File watcher
    fileWatcher.start();

    // Periodic reindex
    const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
    reindexTimer = setInterval(async () => {
      logger.log({ msg: 'Running periodic reindex...', op: 'server.reindex' });
      const reindexResult = await indexAllSessions(false, sessionRepo, logger);
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
    await wsTransport?.stop();
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
