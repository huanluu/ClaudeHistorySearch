import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { FileWatcher, type IndexFn, type WatchFn } from './FileWatcher';
import type { Logger, SessionRepository, SessionSource } from '../../shared/provider/index';

function createMockWatcher() {
  const emitter = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> };
  emitter.close = vi.fn(() => Promise.resolve());
  return emitter;
}

function createMockSource(name: string, dir: string, pattern: string): SessionSource {
  return {
    name,
    sessionDir: dir,
    filePattern: pattern,
    parse: vi.fn().mockResolvedValue({
      sessionId: 'test', project: null, startedAt: null,
      lastActivityAt: null, preview: null, source: name, messages: [],
    }),
  };
}

describe('FileWatcher', () => {
  let mockWatcher: ReturnType<typeof createMockWatcher>;
  let mockWatchFn: WatchFn;
  let mockIndexFn: IndexFn;
  let mockRepo: SessionRepository;
  let mockLogger: Logger;
  let claudeSource: SessionSource;
  let copilotSource: SessionSource;

  beforeEach(() => {
    mockWatcher = createMockWatcher();
    mockWatchFn = vi.fn().mockReturnValue(mockWatcher) as unknown as WatchFn;
    mockIndexFn = vi.fn().mockResolvedValue(undefined) as unknown as IndexFn;
    mockRepo = {} as SessionRepository;
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    claudeSource = createMockSource('claude', '/projects', '**/*.jsonl');
    copilotSource = createMockSource('copilot', '/copilot-history', '*.json');
  });

  it('isActive() returns false before start()', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    expect(fw.isActive()).toBe(false);
  });

  it('start() sets isActive() to true', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    expect(fw.isActive()).toBe(true);
  });

  it('start() creates a watcher per source with correct glob', () => {
    const fw = new FileWatcher([claudeSource, copilotSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    expect(mockWatchFn).toHaveBeenCalledTimes(2);
    expect(mockWatchFn).toHaveBeenCalledWith(
      '/projects/**/*.jsonl',
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    );
    expect(mockWatchFn).toHaveBeenCalledWith(
      '/copilot-history/*.json',
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    );
  });

  it('calling start() twice is idempotent', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    fw.start();
    expect(mockWatchFn).toHaveBeenCalledTimes(1);
  });

  it('stop() sets isActive() to false', async () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    await fw.stop();
    expect(fw.isActive()).toBe(false);
  });

  it('stop() calls close() on all watchers', async () => {
    const watcher1 = createMockWatcher();
    const watcher2 = createMockWatcher();
    let callCount = 0;
    const watchFn = vi.fn(() => {
      callCount++;
      return callCount === 1 ? watcher1 : watcher2;
    });

    const fw = new FileWatcher([claudeSource, copilotSource], mockRepo, mockLogger, mockIndexFn, watchFn as unknown as WatchFn);
    fw.start();
    await fw.stop();
    expect(watcher1.close).toHaveBeenCalled();
    expect(watcher2.close).toHaveBeenCalled();
  });

  it('stop() on unstarted watcher is a no-op', async () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    await expect(fw.stop()).resolves.toBeUndefined();
  });

  it('file change event triggers indexFn with correct source', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    mockWatcher.emit('change', '/path/to/file.jsonl');
    expect(mockIndexFn).toHaveBeenCalledWith('/path/to/file.jsonl', true, claudeSource, mockRepo, mockLogger);
  });

  it('file add event triggers indexFn with forceReindex=false', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    mockWatcher.emit('add', '/path/to/file.jsonl');
    expect(mockIndexFn).toHaveBeenCalledWith('/path/to/file.jsonl', false, claudeSource, mockRepo, mockLogger);
  });

  it('watcher error event is logged with source name', () => {
    const fw = new FileWatcher([claudeSource], mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    const testError = new Error('EMFILE: too many open files');
    mockWatcher.emit('error', testError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'File watcher error (claude)',
        op: 'filewatcher.error',
        err: testError,
      }),
    );
  });
});
