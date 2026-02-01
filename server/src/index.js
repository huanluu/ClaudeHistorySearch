import Bonjour from 'bonjour-service';
import { watch } from 'chokidar';
import { execSync } from 'child_process';
import { indexAllSessions, indexSessionFile, PROJECTS_DIR } from './indexer.js';
import routes from './routes.js';
import { DB_PATH } from './database.js';
import { authMiddleware } from './auth/middleware.js';
import { hasApiKey } from './auth/keyManager.js';
import { HttpTransport } from './transport/index.js';

const PORT = process.env.PORT || 3847;
const SERVICE_TYPE = 'claudehistory';

// Check if macOS firewall stealth mode is enabled (blocks Bonjour discovery)
function isStealthModeEnabled() {
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

// Authentication middleware
transport.use(authMiddleware);

// Mount API routes
transport.use('/', routes);

// Start server
async function main() {
  await transport.start();

  console.log(`Claude History Server running on http://0.0.0.0:${PORT}`);
  console.log(`Database: ${DB_PATH}`);

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
  let bonjour = null;
  let service = null;
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
  const watcher = watch(`${PROJECTS_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  });

  watcher.on('change', async (path) => {
    console.log(`File changed: ${path}`);
    await indexSessionFile(path, true);
  });

  watcher.on('add', async (path) => {
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
  const shutdown = async () => {
    console.log('\nShutting down...');
    clearInterval(reindexTimer);
    if (service) service.stop();
    if (bonjour) bonjour.destroy();
    watcher.close();
    await transport.stop();
    console.log('Server stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
