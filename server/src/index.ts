import Bonjour from 'bonjour-service';
import { watch, type FSWatcher } from 'chokidar';
import { execSync } from 'child_process';
import { indexAllSessions, indexSessionFile, PROJECTS_DIR } from './indexer.js';
import routes, { setHeartbeatService } from './routes.js';
import { DB_PATH } from './database.js';
import { authMiddleware } from './auth/middleware.js';
import { hasApiKey } from './auth/keyManager.js';
import { HttpTransport, WebSocketTransport, type AuthenticatedWebSocket, type WSMessage } from './transport/index.js';
import { HeartbeatService } from './services/HeartbeatService.js';
import { logger } from './logger.js';

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

// Authentication middleware
transport.use(authMiddleware);

// Mount API routes
transport.use('/', routes);

// Start server
async function main(): Promise<void> {
  await transport.start();

  logger.log(`Claude History Server running on http://0.0.0.0:${PORT}`);
  logger.log(`Database: ${DB_PATH}`);

  // Initialize WebSocket transport (attached to HTTP server)
  const httpServer = transport.getServer();
  if (httpServer) {
    wsTransport = new WebSocketTransport({
      server: httpServer,
      path: '/ws',
      pingInterval: 30000,
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
  const result = await indexAllSessions();
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
    await indexSessionFile(path, true);
  });

  watcher.on('add', async (path: string) => {
    logger.log(`New file: ${path}`);
    await indexSessionFile(path, false);
  });

  logger.log('Watching for file changes...\n');

  // Periodic reindex to catch any missed files (watcher can be unreliable)
  const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const reindexTimer = setInterval(async () => {
    logger.log('Running periodic reindex...');
    const reindexResult = await indexAllSessions();
    if (reindexResult.indexed > 0) {
      logger.log(`Periodic reindex: ${reindexResult.indexed} new sessions indexed`);
    } else {
      logger.log('Periodic reindex: no new sessions');
    }
  }, REINDEX_INTERVAL);
  logger.log(`Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes\n`);

  // Heartbeat service for automated work item analysis
  const heartbeatService = new HeartbeatService();
  setHeartbeatService(heartbeatService);  // Make available to API routes
  const heartbeatConfig = heartbeatService.getConfig();

  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatRunCount = 0;

  if (heartbeatConfig.enabled) {
    const runHeartbeatOnce = async (label: string): Promise<void> => {
      heartbeatRunCount++;
      logger.log(`${label} (run ${heartbeatRunCount}${heartbeatConfig.maxRuns > 0 ? `/${heartbeatConfig.maxRuns}` : ''})...`);
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
      if (heartbeatConfig.maxRuns > 0 && heartbeatRunCount >= heartbeatConfig.maxRuns) {
        logger.log(`Heartbeat: maxRuns (${heartbeatConfig.maxRuns}) reached, stopping scheduled heartbeats`);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
    };

    // Run heartbeat periodically
    heartbeatTimer = setInterval(() => {
      if (heartbeatConfig.maxRuns > 0 && heartbeatRunCount >= heartbeatConfig.maxRuns) {
        return; // Guard against race with clearInterval
      }
      runHeartbeatOnce('Running heartbeat');
    }, heartbeatConfig.intervalMs);

    // Run once on startup (delayed to let indexer initialize)
    setTimeout(() => {
      runHeartbeatOnce('Running initial heartbeat');
    }, 5000);

    logger.log(`Heartbeat scheduled every ${heartbeatConfig.intervalMs / 1000 / 60} minutes`);
    if (heartbeatConfig.maxRuns > 0) {
      logger.log(`Heartbeat max runs: ${heartbeatConfig.maxRuns}`);
    }
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
