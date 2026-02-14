import { createApp } from './app.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env.PORT || '3847', 10);

async function main(): Promise<void> {
  const app = createApp({ port: PORT });

  // Register signal handlers before start() so a SIGINT during
  // startup still triggers a clean shutdown.
  const shutdown = async (): Promise<void> => {
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.start();
}

main().catch((err: Error) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
