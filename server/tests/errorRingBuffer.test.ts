import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ErrorRingBuffer, createLogger } from '../src/provider/index.js';
import type { ErrorEntry } from '../src/provider/index.js';

function makeEntry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
  return {
    timestamp: new Date().toISOString(),
    message: 'test error',
    ...overrides,
  };
}

describe('ErrorRingBuffer', () => {
  it('stores and retrieves entries', () => {
    const buffer = new ErrorRingBuffer(10);
    buffer.push(makeEntry({ message: 'err1' }));
    buffer.push(makeEntry({ message: 'err2' }));

    const recent = buffer.getRecent();
    expect(recent).toHaveLength(2);
    expect(recent[0].message).toBe('err2'); // newest first
    expect(recent[1].message).toBe('err1');
  });

  it('evicts oldest entries when capacity is exceeded', () => {
    const buffer = new ErrorRingBuffer(3);
    buffer.push(makeEntry({ message: 'a' }));
    buffer.push(makeEntry({ message: 'b' }));
    buffer.push(makeEntry({ message: 'c' }));
    buffer.push(makeEntry({ message: 'd' })); // evicts 'a'

    const recent = buffer.getRecent();
    expect(recent).toHaveLength(3);
    expect(recent.map(e => e.message)).toEqual(['d', 'c', 'b']);
  });

  it('getRecent(n) returns only the last N entries', () => {
    const buffer = new ErrorRingBuffer(10);
    for (let i = 0; i < 5; i++) {
      buffer.push(makeEntry({ message: `err${i}` }));
    }

    const recent = buffer.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].message).toBe('err4');
    expect(recent[1].message).toBe('err3');
  });

  it('returns empty array when buffer is empty', () => {
    const buffer = new ErrorRingBuffer(10);
    expect(buffer.getRecent()).toEqual([]);
    expect(buffer.getRecent(5)).toEqual([]);
  });

  it('countSince counts entries after a given timestamp', () => {
    const buffer = new ErrorRingBuffer(10);

    const oldTime = new Date('2025-01-01T00:00:00Z');
    const midTime = new Date('2025-06-01T00:00:00Z');
    const newTime = new Date('2025-12-01T00:00:00Z');

    buffer.push(makeEntry({ timestamp: oldTime.toISOString(), message: 'old' }));
    buffer.push(makeEntry({ timestamp: midTime.toISOString(), message: 'mid' }));
    buffer.push(makeEntry({ timestamp: newTime.toISOString(), message: 'new' }));

    // Count entries after mid-2025
    expect(buffer.countSince(new Date('2025-05-01T00:00:00Z'))).toBe(2);
    // Count entries after end of 2025
    expect(buffer.countSince(new Date('2025-11-01T00:00:00Z'))).toBe(1);
    // Count entries in the future
    expect(buffer.countSince(new Date('2026-01-01T00:00:00Z'))).toBe(0);
    // Count all entries
    expect(buffer.countSince(new Date('2024-01-01T00:00:00Z'))).toBe(3);
  });

  it('logger.error() pushes to buffer when configured', () => {
    const testDir = join(tmpdir(), `ring-buffer-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const buffer = new ErrorRingBuffer(10);
      const logger = createLogger(join(testDir, 'test.log'), { errorBuffer: buffer });

      logger.error({ msg: 'db failed', op: 'db.query', errType: 'db_error' });
      logger.error({ msg: 'timeout', op: 'http.request' });
      logger.log({ msg: 'this should NOT go to buffer' });
      logger.warn({ msg: 'nor should this' });

      const entries = buffer.getRecent();
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe('timeout');
      expect(entries[0].op).toBe('http.request');
      expect(entries[1].message).toBe('db failed');
      expect(entries[1].errType).toBe('db_error');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
