import { createApp, type App } from './app.js';
import { logger } from './provider/index.js';

const PORT = parseInt(process.env.PORT || '3847', 10);

let currentApp: App | null = null;

// --- Global error safety net ---
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({
    msg: 'Unhandled promise rejection',
    op: 'process.unhandledRejection',
    err: reason instanceof Error ? reason : String(reason),
    context: { stack: reason instanceof Error ? reason.stack : undefined },
  });
});

process.on('uncaughtException', async (error: Error) => {
  logger.error({
    msg: 'Uncaught exception — shutting down',
    op: 'process.uncaughtException',
    err: error,
    context: { stack: error.stack },
  });
  try {
    await currentApp?.stop();
  } catch { /* best-effort */ }
  process.exit(1);
});

async function main(): Promise<void> {
  const app = createApp({ port: PORT });
  currentApp = app;

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
  logger.error({ msg: `Failed to start server: ${err.message}`, op: 'server.start', err });
  process.exit(1);
});
