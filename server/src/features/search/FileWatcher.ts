import { watch, type FSWatcher } from 'chokidar';
import { indexSessionFile } from './indexer';
import type { SessionRepository, Logger, SessionSource, FileSystem } from '../../shared/provider/index';

export type IndexFn = (filePath: string, forceReindex: boolean, source: SessionSource, repo: SessionRepository, logger: Logger, fs: FileSystem) => Promise<void>;
export type WatchFn = typeof watch;

/**
 * FileWatcher monitors session source directories for new or changed
 * session files and triggers incremental indexing.
 *
 * Supports multiple sources (Claude, Copilot, etc.) — each with its own
 * directory and file pattern.
 *
 * Lifecycle: call `start()` to begin watching, `stop()` to tear down.
 */
export class FileWatcher {
  private watchers: FSWatcher[] = [];

  constructor(
    private readonly sources: SessionSource[],
    private readonly repo: SessionRepository,
    private readonly logger: Logger,
    private readonly fs: FileSystem,
    private readonly indexFn: IndexFn = (filePath, forceReindex, source, repo, logger, fs) =>
      indexSessionFile(filePath, forceReindex, source, repo, logger, fs).then(() => {}),
    private readonly watchFn: WatchFn = watch,
  ) {}

  /**
   * Start watching all source directories for file changes.
   * Uses chokidar with `awaitWriteFinish` to debounce rapid writes.
   */
  start(): void {
    if (this.watchers.length > 0) {
      return; // Already watching
    }

    for (const source of this.sources) {
      const glob = `${source.sessionDir}/${source.filePattern}`;
      const watcher = this.watchFn(glob, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 2000,
          pollInterval: 100
        }
      });

      watcher.on('error', (error: unknown) => {
        this.logger.error({ msg: `File watcher error (${source.name})`, op: 'filewatcher.error', err: error });
      });

      watcher.on('change', async (path: string) => {
        this.logger.log({ msg: `File changed: ${path}`, op: 'filewatcher.change', context: { path, source: source.name } });
        await this.indexFn(path, true, source, this.repo, this.logger, this.fs);
      });

      watcher.on('add', async (path: string) => {
        this.logger.log({ msg: `New file: ${path}`, op: 'filewatcher.add', context: { path, source: source.name } });
        await this.indexFn(path, false, source, this.repo, this.logger, this.fs);
      });

      this.watchers.push(watcher);
      this.logger.log({ msg: `Watching ${source.name} sessions: ${glob}`, op: 'filewatcher.start' });
    }
  }

  /**
   * Whether the file watcher is currently active.
   */
  isActive(): boolean {
    return this.watchers.length > 0;
  }

  /**
   * Stop watching and release file system resources.
   */
  async stop(): Promise<void> {
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
  }
}
