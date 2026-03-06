import { watch, type FSWatcher } from 'chokidar';
import { indexSessionFile } from './indexer';
import type { SessionRepository, Logger } from '../../shared/provider/index';

export type IndexFn = (filePath: string, forceReindex: boolean, repo: SessionRepository, logger: Logger) => Promise<void>;
export type WatchFn = typeof watch;

/**
 * FileWatcher monitors the Claude projects directory for new or changed JSONL
 * session files and triggers incremental indexing.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to tear down.
 */
export class FileWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly projectsDir: string,
    private readonly repo: SessionRepository,
    private readonly logger: Logger,
    private readonly indexFn: IndexFn = (filePath, forceReindex, repo, logger) =>
      indexSessionFile(filePath, forceReindex, new Map(), repo, logger).then(() => {}),
    private readonly watchFn: WatchFn = watch,
  ) {}

  /**
   * Start watching for JSONL file changes.
   * Uses chokidar with `awaitWriteFinish` to debounce rapid writes.
   */
  start(): void {
    if (this.watcher) {
      return; // Already watching
    }

    this.watcher = this.watchFn(`${this.projectsDir}/**/*.jsonl`, {
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
      await this.indexFn(path, true, this.repo, this.logger);
    });

    this.watcher.on('add', async (path: string) => {
      this.logger.log({ msg: `New file: ${path}`, op: 'filewatcher.add', context: { path } });
      await this.indexFn(path, false, this.repo, this.logger);
    });

    this.logger.log({ msg: 'Watching for file changes...', op: 'filewatcher.start' });
  }

  /**
   * Whether the file watcher is currently active.
   */
  isActive(): boolean {
    return this.watcher !== null;
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
