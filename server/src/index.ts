import Bonjour from 'bonjour-service';
import { watch, type FSWatcher } from 'chokidar';
import { execSync } from 'child_process';
import { indexAllSessions, indexSessionFile, PROJECTS_DIR } from './indexer.js';
import routes from './routes.js';
import { DB_PATH } from './database.js';
import { authMiddleware } from './auth/middleware.js';
import { hasApiKey } from './auth/keyManager.js';
import { HttpTransport, WebSocketTransport, type AuthenticatedWebSocket, type WSMessage } from './transport/index.js';

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

  console.log(`Claude History Server running on http://0.0.0.0:${PORT}`);
  console.log(`Database: ${DB_PATH}`);

  // Initialize WebSocket transport (attached to HTTP server)
  const httpServer = transport.getServer();
  if (httpServer) {
    wsTransport = new WebSocketTransport({
      server: httpServer,
      path: '/ws',
      pingInterval: 30000,
      onConnection: (ws: AuthenticatedWebSocket) => {
        console.log(`[WebSocket] Client connected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`);
      },
      onDisconnection: (ws: AuthenticatedWebSocket) => {
        console.log(`[WebSocket] Client disconnected: ${ws.clientId} (${wsTransport?.getClientCount()} total)`);
      },
      onMessage: (ws: AuthenticatedWebSocket, message: WSMessage) => {
        console.log(`[WebSocket] Message from ${ws.clientId}:`, message.type);
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
    console.log(`WebSocket server available at ws://0.0.0.0:${PORT}/ws`);
  }

  // API key status
  if (hasApiKey()) {
    console.log('Authentication: API key required');
  } else {
    console.log('Authentication: No API key configured (run "npm run key:generate" to secure the server)');
  }

  // Initial indexing
  console.log('\nStarting initial index...');
  const result = await indexAllSessions();
  console.log(`Initial index complete: ${result.indexed} sessions indexed\n`);

  // Advertise via Bonjour/mDNS (auto-disabled if stealth mode is on)
  let bonjour: Bonjour.default | null = null;
  let service: ReturnType<Bonjour.default['publish']> | null = null;
  const stealthMode = isStealthModeEnabled();
  if (stealthMode) {
    console.log('Bonjour advertisement disabled (firewall stealth mode is on)');
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
    console.log(`Bonjour service advertised as _${SERVICE_TYPE}._tcp on port ${PORT}`);
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
    console.log(`File changed: ${path}`);
    await indexSessionFile(path, true);
  });

  watcher.on('add', async (path: string) => {
    console.log(`New file: ${path}`);
    await indexSessionFile(path, false);
  });

  console.log('Watching for file changes...\n');

  // Periodic reindex to catch any missed files (watcher can be unreliable)
  const REINDEX_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const reindexTimer = setInterval(async () => {
    console.log('Running periodic reindex...');
    const reindexResult = await indexAllSessions();
    if (reindexResult.indexed > 0) {
      console.log(`Periodic reindex: ${reindexResult.indexed} new sessions indexed`);
    } else {
      console.log('Periodic reindex: no new sessions');
    }
  }, REINDEX_INTERVAL);
  console.log(`Periodic reindex scheduled every ${REINDEX_INTERVAL / 1000 / 60} minutes\n`);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    clearInterval(reindexTimer);
    service?.stop?.();
    bonjour?.destroy();
    watcher.close();
    await wsTransport?.stop();
    await transport.stop();
    console.log('Server stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: Error) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
