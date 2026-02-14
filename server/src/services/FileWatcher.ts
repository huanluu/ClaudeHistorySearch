import { watch, type FSWatcher } from 'chokidar';
import { indexSessionFile } from '../indexer.js';
import type { SessionRepository } from '../database/index.js';
import { logger } from '../logger.js';

/**
 * FileWatcher monitors the Claude projects directory for new or changed JSONL
 * session files and triggers incremental indexing.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to tear down.
 */
export class FileWatcher {
  private projectsDir: string;
  private repo: SessionRepository;
  private watcher: FSWatcher | null = null;

  constructor(projectsDir: string, repo: SessionRepository) {
    this.projectsDir = projectsDir;
    this.repo = repo;
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

    this.watcher.on('change', async (path: string) => {
      logger.log(`File changed: ${path}`);
      await indexSessionFile(path, true, new Map(), this.repo);
    });

    this.watcher.on('add', async (path: string) => {
      logger.log(`New file: ${path}`);
      await indexSessionFile(path, false, new Map(), this.repo);
    });

    logger.log('Watching for file changes...\n');
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
