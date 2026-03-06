import type { MockInstance } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createLogger } from '../index';
import type { Logger } from '../index';
import { FileWatcher } from '../../../features/search/index';
import type { SessionRepository } from '../index';

let testDir: string;
let logPath: string;
let logger: Logger;

beforeEach(() => {
  testDir = join(tmpdir(), `error-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  logPath = join(testDir, 'test.log');
  logger = createLogger(logPath);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Read all JSONL lines from the log file as parsed objects */
function readLogLines(path: string): Record<string, unknown>[] {
  const content = readFileSync(path, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

describe('Global error handlers', () => {
  describe('unhandledRejection handler', () => {
    let handler: (reason: unknown, promise: Promise<unknown>) => void;

    beforeEach(() => {
      handler = (reason: unknown) => {
        logger.error({
          msg: 'Unhandled promise rejection',
          op: 'process.unhandledRejection',
          err: reason instanceof Error ? reason : String(reason),
          context: { stack: reason instanceof Error ? reason.stack : undefined },
        });
      };
      process.on('unhandledRejection', handler);
    });

    afterEach(() => {
      process.removeListener('unhandledRejection', handler);
    });

    it('logs Error rejections with stack trace', () => {
      const testError = new Error('test rejection');
      process.emit('unhandledRejection', testError, Promise.resolve());

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'ERROR',
        msg: 'Unhandled promise rejection',
        op: 'process.unhandledRejection',
        err: 'test rejection',
      });
      expect(lines[0].context).toHaveProperty('stack');
    });

    it('logs non-Error rejections as strings', () => {
      process.emit('unhandledRejection', 'string reason', Promise.resolve());

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'ERROR',
        msg: 'Unhandled promise rejection',
        err: 'string reason',
      });
    });
  });

  describe('uncaughtException handler', () => {
    let handler: (error: Error) => void;
    let exitSpy: MockInstance<typeof process.exit>;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
      handler = (error: Error) => {
        logger.error({
          msg: 'Uncaught exception — shutting down',
          op: 'process.uncaughtException',
          err: error,
          context: { stack: error.stack },
        });
        process.exit(1);
      };
      process.on('uncaughtException', handler);
    });

    afterEach(() => {
      process.removeListener('uncaughtException', handler);
      exitSpy.mockRestore();
    });

    it('logs the exception and calls process.exit(1)', () => {
      const testError = new Error('test exception');
      process.emit('uncaughtException', testError);

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'ERROR',
        msg: 'Uncaught exception — shutting down',
        op: 'process.uncaughtException',
        err: 'test exception',
      });
      expect(lines[0].context).toHaveProperty('stack');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('FileWatcher error handler', () => {
    let watchDir: string;
    const repo = {} as SessionRepository; // Mock — not needed for error event test

    beforeEach(() => {
      watchDir = join(testDir, 'projects');
      mkdirSync(watchDir, { recursive: true });
    });

    it('logs chokidar errors instead of crashing', async () => {
      const mockSource = { name: 'claude', sessionDir: watchDir, filePattern: '**/*.jsonl', parse: vi.fn() };
      const fileWatcher = new FileWatcher([mockSource], repo, logger);
      fileWatcher.start();

      // Emit an error on the internal chokidar watcher
      const internalWatchers = (fileWatcher as Record<string, unknown>).watchers as Array<{ emit: (event: string, error: Error) => void }>;
      internalWatchers[0].emit('error', new Error('EMFILE: too many open files'));

      const lines = readLogLines(logPath);
      // Find the error line (start() also logs a 'Watching...' line)
      const errorLine = lines.find(l => l.msg === 'File watcher error (claude)');
      expect(errorLine).toBeDefined();
      expect(errorLine).toMatchObject({
        level: 'ERROR',
        msg: 'File watcher error (claude)',
        op: 'filewatcher.error',
        err: 'EMFILE: too many open files',
      });

      await fileWatcher.stop();
    });
  });
});
