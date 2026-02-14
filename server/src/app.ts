import Bonjour from 'bonjour-service';
import { execSync } from 'child_process';
import { createSessionRepository, createHeartbeatRepository, DB_PATH } from './database/index.js';
import { authMiddleware, hasApiKey, WorkingDirValidator, logger } from './provider/index.js';
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
  const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo);
  const fileWatcher = new FileWatcher(PROJECTS_DIR, sessionRepo);

  // --- Transports ---
  const transport = new HttpTransport({ port });
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
    if (section === 'security') {
      const updatedSecurity = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
      const updatedDirs = updatedSecurity?.allowedWorkingDirs ?? [];
      workingDirValidator.setAllowedDirs(updatedDirs);
      logger.log(`Security config updated: ${updatedDirs.length} allowed working director${updatedDirs.length === 1 ? 'y' : 'ies'}`);
    }
  };

  // --- Router ---
  const router = createRouter({
    repo: sessionRepo,
    heartbeatService,
    configService,
    onConfigChanged,
  });
  transport.use('/', router);

  // --- Lifecycle ---
  async function start(): Promise<void> {
    // Security logging
    if (allowedDirs.length === 0) {
      logger.log('WARNING: No allowed working directories configured. All session.start/resume requests will be denied.');
      logger.log('Configure allowed directories via the admin UI at /admin');
    } else {
      logger.log(`Security: ${allowedDirs.length} allowed working director${allowedDirs.length === 1 ? 'y' : 'ies'} configured`);
    }

    // Start HTTP server (router is fully wired before accepting requests)
    await transport.start();

    const boundPort = transport.getPort();
    logger.log(`Claude History Server running on http://0.0.0.0:${boundPort}`);
    logger.log(`Database: ${DB_PATH}`);

    // Initialize WebSocket transport (attached to HTTP server)
    const httpServer = transport.getServer();
    if (httpServer) {
      wsTransport = new WebSocketTransport({
        server: httpServer,
        path: '/ws',
        pingInterval: 30000,
        validator: workingDirValidator,
        onConnection: (ws: AuthenticatedWebSocket) => {
          logger.log(`[WebSocket] Client connected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`);
        },
        onDisconnection: (ws: AuthenticatedWebSocket) => {
          logger.log(`[WebSocket] Client disconnected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`);
        },
        onMessage: (ws: AuthenticatedWebSocket, message: WSMessage) => {
          logger.log(`[WebSocket] Message from ${ws.clientId}:`, message.type);
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
      logger.log(`WebSocket server available at ws://0.0.0.0:${boundPort}/ws`);
    }

    // API key status
    if (hasApiKey()) {
      logger.log('Authentication: API key required');
    } else {
      logger.log('Authentication: No API key configured (run "npm run key:generate" to secure the server)');
    }

    // Initial indexing
    logger.log('\nStarting initial index...');
    const result = await indexAllSessions(false, sessionRepo);
    logger.log(`Initial index complete: ${result.indexed} sessions indexed\n`);

    // Bonjour advertisement (auto-disabled if stealth mode is on)
    const stealthMode = isStealthModeEnabled();
    if (stealthMode) {
      logger.log('Bonjour advertisement disabled (firewall stealth mode is on)');
    } else {
      bonjour = new Bonjour.default();
      service = bonjour.publish({
        name: 'Claude History Server',
        type: serviceType,
        port: boundPort,
        txt: { version: '1.0.0' }
      });
      logger.log(`Bonjour service advertised as _${serviceType}._tcp on port ${boundPort}`);
    }

    // File watcher
    fileWatcher.start();

    // Periodic reindex
    const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
    reindexTimer = setInterval(async () => {
      logger.log('Running periodic reindex...');
      const reindexResult = await indexAllSessions(false, sessionRepo);
      if (reindexResult.indexed > 0) {
        logger.log(`Periodic reindex: ${reindexResult.indexed} new sessions indexed`);
      } else {
        logger.log('Periodic reindex: no new sessions');
      }
    }, REINDEX_INTERVAL);
    logger.log(`Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes\n`);

    // Heartbeat scheduler
    const heartbeatConfig = heartbeatService.getConfig();
    if (heartbeatConfig.enabled) {
      heartbeatService.startScheduler();
      logger.log(`Heartbeat working directory: ${heartbeatConfig.workingDirectory}\n`);
    } else {
      logger.log('Heartbeat: disabled\n');
    }
  }

  async function stop(): Promise<void> {
    logger.log('\nShutting down...');
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
    logger.log('Server stopped');
  }

  return {
    start,
    stop,
    getPort: () => transport.getPort(),
    getHttpTransport: () => transport,
  };
}
