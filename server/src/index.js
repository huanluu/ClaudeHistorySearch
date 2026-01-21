import express from 'express';
import Bonjour from 'bonjour-service';
import { watch } from 'chokidar';
import { indexAllSessions, indexSessionFile, PROJECTS_DIR } from './indexer.js';
import routes from './routes.js';
import { DB_PATH } from './database.js';

const PORT = 3847;
const SERVICE_TYPE = 'claudehistory';

const app = express();
app.use(express.json());

// CORS middleware for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Mount API routes
app.use('/', routes);

// Start server
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Claude History Server running on http://0.0.0.0:${PORT}`);
  console.log(`Database: ${DB_PATH}`);

  // Initial indexing
  console.log('\nStarting initial index...');
  const result = await indexAllSessions();
  console.log(`Initial index complete: ${result.indexed} sessions indexed\n`);

  // Advertise via Bonjour/mDNS
  const bonjour = new Bonjour.default();
  const service = bonjour.publish({
    name: 'Claude History Server',
    type: SERVICE_TYPE,
    port: PORT,
    txt: {
      version: '1.0.0'
    }
  });

  console.log(`Bonjour service advertised as _${SERVICE_TYPE}._tcp on port ${PORT}`);

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

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    service.stop();
    bonjour.destroy();
    watcher.close();
    server.close(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
