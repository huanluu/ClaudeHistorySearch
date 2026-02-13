import Bonjour from 'bonjour-service';
import { watch, type FSWatcher } from 'chokidar';
import { execSync } from 'child_process';
import { indexAllSessions, indexSessionFile, PROJECTS_DIR } from './indexer.js';
import { createRouter, setHeartbeatService, setConfigService, setOnConfigChanged } from './routes.js';
import { createSessionRepository, createHeartbeatRepository, DB_PATH } from './database/index.js';
import { authMiddleware } from './auth/middleware.js';
import { hasApiKey } from './auth/keyManager.js';
import { HttpTransport, WebSocketTransport, type AuthenticatedWebSocket, type WSMessage } from './transport/index.js';
import { HeartbeatService } from './services/HeartbeatService.js';
import { logger } from './logger.js';
import { ConfigService } from './services/ConfigService.js';
import { WorkingDirValidator } from './security/WorkingDirValidator.js';

const PORT = parseInt(process.env.PORT || '3847', 10);
const SERVICE_TYPE = 'claudehistory';

// Check if macOS firewall stealth mode is enabled (blocks Bonjour discovery)
function isStealthModeEnabled(): boolean {
  try {
    const output = execSync('/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return output.includes('stealth mode is on');
  } catch {
    // If we can't check, assume stealth mode is off
    return false;
  }
}

// Create HTTP transport
const transport = new HttpTransport({ port: PORT });

// WebSocket transport (initialized after HTTP server starts)
let wsTransport: WebSocketTransport | null = null;

// Create session repository and router
const sessionRepo = createSessionRepository();
const router = createRouter(sessionRepo);

// Authentication middleware
transport.use(authMiddleware);

// Mount API routes
transport.use('/', router);

// Start server
async function main(): Promise<void> {
  await transport.start();

  logger.log(`Claude History Server running on http://0.0.0.0:${PORT}`);
  logger.log(`Database: ${DB_PATH}`);

  // Initialize working directory validator for session security
  const configService = new ConfigService();
  const securityConfig = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
  const allowedDirs = securityConfig?.allowedWorkingDirs ?? [];
  const workingDirValidator = new WorkingDirValidator(allowedDirs);

  if (allowedDirs.length === 0) {
    logger.log('WARNING: No allowed working directories configured. All session.start/resume requests will be denied.');
    logger.log('Configure allowed directories via the admin UI at /admin');
  } else {
    logger.log(`Security: ${allowedDirs.length} allowed working director${allowedDirs.length === 1 ? 'y' : 'ies'} configured`);
  }

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
        // Handle application-level messages here
        // For now, just echo back
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
    logger.log(`WebSocket server available at ws://0.0.0.0:${PORT}/ws`);
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

  // Advertise via Bonjour/mDNS (auto-disabled if stealth mode is on)
  let bonjour: Bonjour.default | null = null;
  let service: ReturnType<Bonjour.default['publish']> | null = null;
  const stealthMode = isStealthModeEnabled();
  if (stealthMode) {
    logger.log('Bonjour advertisement disabled (firewall stealth mode is on)');
  } else {
    bonjour = new Bonjour.default();
    service = bonjour.publish({
      name: 'Claude History Server',
      type: SERVICE_TYPE,
      port: PORT,
      txt: {
        version: '1.0.0'
      }
    });
    logger.log(`Bonjour service advertised as _${SERVICE_TYPE}._tcp on port ${PORT}`);
  }

  // Watch for file changes
  const watcher: FSWatcher = watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  watcher.on('change', async (path: string) => {
    logger.log(`File changed: ${path}`);
    await indexSessionFile(path, true, new Map(), sessionRepo);
  });

  watcher.on('add', async (path: string) => {
    logger.log(`New file: ${path}`);
    await indexSessionFile(path, false, new Map(), sessionRepo);
  });

  logger.log('Watching for file changes...\n');

  // Periodic reindex to catch any missed files (watcher can be unreliable)
  const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const reindexTimer = setInterval(async () => {
    logger.log('Running periodic reindex...');
    const reindexResult = await indexAllSessions(false, sessionRepo);
    if (reindexResult.indexed > 0) {
      logger.log(`Periodic reindex: ${reindexResult.indexed} new sessions indexed`);
    } else {
      logger.log('Periodic reindex: no new sessions');
    }
  }, REINDEX_INTERVAL);
  logger.log(`Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes\n`);

  // Heartbeat service for automated work item analysis
  const heartbeatRepo = createHeartbeatRepository();
  const heartbeatService = new HeartbeatService(undefined, undefined, heartbeatRepo);
  setHeartbeatService(heartbeatService);  // Make available to API routes

  // Config service for admin UI (created earlier for security config)
  setConfigService(configService);

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatRunCount = 0;

  function restartHeartbeatTimer(): void {
    // Clear existing timer
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    heartbeatRunCount = 0;

    const config = heartbeatService.getConfig();
    if (!config.enabled) {
      logger.log('Heartbeat rescheduled: disabled');
      return;
    }

    const runHeartbeatOnce = async (label: string): Promise<void> => {
      heartbeatRunCount++;
      logger.log(`${label} (run ${heartbeatRunCount}${config.maxRuns > 0 ? `/${config.maxRuns}` : ''})...`);
      try {
        const heartbeatResult = await heartbeatService.runHeartbeat();
        if (heartbeatResult.sessionsCreated > 0) {
          logger.log(`Heartbeat: ${heartbeatResult.sessionsCreated} sessions created`);
        } else {
          logger.log('Heartbeat: no changes detected');
        }
        if (heartbeatResult.errors.length > 0) {
          logger.error('Heartbeat errors:', heartbeatResult.errors);
        }
      } catch (error) {
        logger.error('Heartbeat error:', error);
      }

      // Stop scheduling if maxRuns reached
      if (config.maxRuns > 0 && heartbeatRunCount >= config.maxRuns) {
        logger.log(`Heartbeat: maxRuns (${config.maxRuns}) reached, stopping scheduled heartbeats`);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
    };

    // Run heartbeat periodically
    heartbeatTimer = setInterval(() => {
      if (config.maxRuns > 0 && heartbeatRunCount >= config.maxRuns) {
        return; // Guard against race with clearInterval
      }
      runHeartbeatOnce('Running heartbeat');
    }, config.intervalMs);

    // Run once on startup (delayed to let indexer initialize)
    setTimeout(() => {
      runHeartbeatOnce('Running initial heartbeat');
    }, 5000);

    logger.log(`Heartbeat rescheduled every ${config.intervalMs / 1000 / 60} minutes`);
    if (config.maxRuns > 0) {
      logger.log(`Heartbeat max runs: ${config.maxRuns}`);
    }
  }

  // Wire config change handler to restart heartbeat timer and update security
  setOnConfigChanged((section: string) => {
    if (section === 'heartbeat') {
      // Read the updated config from disk and apply to heartbeat service
      const updatedSection = configService.getSection('heartbeat');
      if (updatedSection) {
        heartbeatService.updateConfig(updatedSection as Partial<import('./services/HeartbeatService.js').HeartbeatConfig>);
      }
      restartHeartbeatTimer();
    }
    if (section === 'security') {
      const updatedSecurity = configService.getSection('security') as { allowedWorkingDirs?: string[] } | null;
      const updatedDirs = updatedSecurity?.allowedWorkingDirs ?? [];
      workingDirValidator.setAllowedDirs(updatedDirs);
      logger.log(`Security config updated: ${updatedDirs.length} allowed working director${updatedDirs.length === 1 ? 'y' : 'ies'}`);
    }
  });

  const heartbeatConfig = heartbeatService.getConfig();

  if (heartbeatConfig.enabled) {
    restartHeartbeatTimer();
    logger.log(`Heartbeat working directory: ${heartbeatConfig.workingDirectory}\n`);
  } else {
    logger.log('Heartbeat: disabled\n');
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.log('\nShutting down...');
    clearInterval(reindexTimer);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    service?.stop?.();
    bonjour?.destroy();
    watcher.close();
    await wsTransport?.stop();
    await transport.stop();
    logger.log('Server stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: Error) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
