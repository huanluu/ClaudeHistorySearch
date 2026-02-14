import { watch, type FSWatcher } from 'chokidar';
import { indexSessionFile } from './indexer.js';
import type { SessionRepository } from '../database/index.js';
import { logger as defaultLogger } from '../provider/index.js';
import type { Logger } from '../provider/index.js';

/**
 * FileWatcher monitors the Claude projects directory for new or changed JSONL
 * session files and triggers incremental indexing.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to tear down.
 */
export class FileWatcher {
  private projectsDir: string;
  private repo: SessionRepository;
  private logger: Logger;
  private watcher: FSWatcher | null = null;

  constructor(projectsDir: string, repo: SessionRepository, logger: Logger = defaultLogger) {
    this.projectsDir = projectsDir;
    this.repo = repo;
    this.logger = logger;
  }

  /**
   * Start watching for JSONL file changes.
   * Uses chokidar with `awaitWriteFinish` to debounce rapid writes.
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = watch(`${this.projectsDir}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    this.watcher.on('error', (error: unknown) => {
      this.logger.error({ msg: 'File watcher error', op: 'filewatcher.error', err: error });
    });

    this.watcher.on('change', async (path: string) => {
      this.logger.log({ msg: `File changed: ${path}`, op: 'filewatcher.change', context: { path } });
      await indexSessionFile(path, true, new Map(), this.repo, this.logger);
    });

    this.watcher.on('add', async (path: string) => {
      this.logger.log({ msg: `New file: ${path}`, op: 'filewatcher.add', context: { path } });
      await indexSessionFile(path, false, new Map(), this.repo, this.logger);
    });

    this.logger.log({ msg: 'Watching for file changes...', op: 'filewatcher.start' });
  }

  /**
   * Stop watching and release file system resources.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
