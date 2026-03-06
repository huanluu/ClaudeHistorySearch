import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { FileWatcher } from './FileWatcher';
import type { Logger, SessionRepository } from '../../shared/provider/index';

function createMockWatcher() {
  const emitter = new EventEmitter();
  (emitter as Record<string, unknown>).close = vi.fn(() => Promise.resolve());
  return emitter;
}

describe('FileWatcher', () => {
  let mockWatcher: ReturnType<typeof createMockWatcher>;
  let mockWatchFn: ReturnType<typeof vi.fn>;
  let mockIndexFn: ReturnType<typeof vi.fn>;
  let mockRepo: SessionRepository;
  let mockLogger: Logger;

  beforeEach(() => {
    mockWatcher = createMockWatcher();
    mockWatchFn = vi.fn().mockReturnValue(mockWatcher);
    mockIndexFn = vi.fn().mockResolvedValue(undefined);
    mockRepo = {} as SessionRepository;
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
  });

  it('isActive() returns false before start()', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    expect(fw.isActive()).toBe(false);
  });

  it('start() sets isActive() to true', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    expect(fw.isActive()).toBe(true);
  });

  it('start() calls watchFn with correct glob pattern', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    expect(mockWatchFn).toHaveBeenCalledWith(
      '/projects/**/*.jsonl',
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    );
  });

  it('calling start() twice is idempotent', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    fw.start();
    expect(mockWatchFn).toHaveBeenCalledTimes(1);
  });

  it('stop() sets isActive() to false', async () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    await fw.stop();
    expect(fw.isActive()).toBe(false);
  });

  it('stop() calls watcher.close()', async () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    await fw.stop();
    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('stop() on unstarted watcher is a no-op', async () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    await expect(fw.stop()).resolves.toBeUndefined();
  });

  it('file change event triggers indexFn with correct args', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    mockWatcher.emit('change', '/path/to/file.jsonl');
    expect(mockIndexFn).toHaveBeenCalledWith('/path/to/file.jsonl', true, mockRepo, mockLogger);
  });

  it('file add event triggers indexFn with forceReindex=false', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    mockWatcher.emit('add', '/path/to/file.jsonl');
    expect(mockIndexFn).toHaveBeenCalledWith('/path/to/file.jsonl', false, mockRepo, mockLogger);
  });

  it('watcher error event is logged', () => {
    const fw = new FileWatcher('/projects', mockRepo, mockLogger, mockIndexFn, mockWatchFn);
    fw.start();
    const testError = new Error('EMFILE: too many open files');
    mockWatcher.emit('error', testError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'File watcher error',
        op: 'filewatcher.error',
        err: testError,
      }),
    );
  });
});
