import { jest } from '@jest/globals';
import { createLogger } from '../src/provider/index.js';
import type { LogEntry } from '../src/provider/index.js';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testDir: string;
let logPath: string;

beforeEach(() => {
  testDir = join(tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  logPath = join(testDir, 'test.log');
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** Read all JSONL lines from the log file as parsed objects */
function readLogLines(path: string): Record<string, unknown>[] {
  const content = readFileSync(path, 'utf-8').trim();
  return content.split('\n').map(line => JSON.parse(line));
}

describe('Logger', () => {
  describe('JSONL output', () => {
    it('log({ msg, op }) writes JSONL with ts, level, msg, op fields', () => {
      const logger = createLogger(logPath);
      logger.log({ msg: 'server started', op: 'server.start' });

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'LOG',
        msg: 'server started',
        op: 'server.start',
      });
      expect(lines[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('error({ msg, err, errType }) writes JSONL with error fields', () => {
      const logger = createLogger(logPath);
      logger.error({
        msg: 'query failed',
        err: new Error('SQLITE_BUSY'),
        errType: 'db_error',
      });

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'ERROR',
        msg: 'query failed',
        err: 'SQLITE_BUSY',
        errType: 'db_error',
      });
    });

    it('log({ msg }) with just msg writes JSONL with ts, level, msg', () => {
      const logger = createLogger(logPath);
      logger.log({ msg: 'hello' });

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 'LOG', msg: 'hello' });
      expect(lines[0].op).toBeUndefined();
    });

    it('each line in log file is valid JSON', () => {
      const logger = createLogger(logPath);
      logger.log({ msg: 'first' });
      logger.warn({ msg: 'second' });
      logger.error({ msg: 'third' });

      const content = readFileSync(logPath, 'utf-8').trim();
      const jsonLines = content.split('\n');
      expect(jsonLines).toHaveLength(3);
      for (const line of jsonLines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('includes context and durationMs when provided', () => {
      const logger = createLogger(logPath);
      logger.log({
        msg: 'indexed',
        op: 'indexer.run',
        durationMs: 250,
        context: { sessionCount: 42 },
      });

      const lines = readLogLines(logPath);
      expect(lines[0]).toMatchObject({
        durationMs: 250,
        context: { sessionCount: 42 },
      });
    });

    it('serializes non-Error err values as strings', () => {
      const logger = createLogger(logPath);
      logger.error({ msg: 'oops', err: 'string error' });

      const lines = readLogLines(logPath);
      expect(lines[0].err).toBe('string error');
    });
  });

  describe('console output', () => {
    it('default: no console output (file-only)', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const logger = createLogger(logPath);
        logger.log({ msg: 'silent' });
        expect(consoleSpy).not.toHaveBeenCalled();
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('console opt-in via { console: true }', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const logger = createLogger(logPath, { console: true });

        logger.log({ msg: 'console test' });
        expect(consoleSpy).toHaveBeenCalledWith('console test');

        logger.error({ msg: 'error test' });
        expect(errorSpy).toHaveBeenCalledWith('error test');

        logger.warn({ msg: 'warn test' });
        expect(warnSpy).toHaveBeenCalledWith('warn test');
      } finally {
        consoleSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('console includes op prefix when provided', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const logger = createLogger(logPath, { console: true });
        logger.log({ msg: 'started', op: 'server.start' });
        expect(consoleSpy).toHaveBeenCalledWith('[server.start] started');
      } finally {
        consoleSpy.mockRestore();
      }
    });
  });

  describe('.warn()', () => {
    it('writes JSONL with WARN level', () => {
      const logger = createLogger(logPath);
      logger.warn({ msg: 'be careful' });

      const lines = readLogLines(logPath);
      expect(lines[0]).toMatchObject({ level: 'WARN', msg: 'be careful' });
    });
  });

  describe('.verbose()', () => {
    it('writes nothing when verbose is disabled', () => {
      const logger = createLogger(logPath, { verbose: false });
      logger.verbose({ msg: 'should not appear' });

      expect(existsSync(logPath)).toBe(false);
    });

    it('writes JSONL with VERBOSE level when enabled', () => {
      const logger = createLogger(logPath, { verbose: true });
      logger.verbose({ msg: 'detailed info' });

      const lines = readLogLines(logPath);
      expect(lines[0]).toMatchObject({ level: 'VERBOSE', msg: 'detailed info' });
    });
  });

  describe('file operations', () => {
    it('appends to existing file', () => {
      const logger = createLogger(logPath);
      logger.log({ msg: 'first' });
      logger.log({ msg: 'second' });

      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(2);
      expect(lines[0].msg).toBe('first');
      expect(lines[1].msg).toBe('second');
    });

    it('creates parent directory if missing', () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'test.log');
      const logger = createLogger(nestedPath);
      logger.log({ msg: 'created dir' });

      const lines = readLogLines(nestedPath);
      expect(lines[0].msg).toBe('created dir');
    });
  });

  describe('rotation', () => {
    it('rotates when file exceeds 10 MB', () => {
      // Create a file larger than 10 MB
      const bigContent = 'x'.repeat(11 * 1024 * 1024);
      writeFileSync(logPath, bigContent);

      // Creating the logger triggers rotation at startup
      const logger = createLogger(logPath);
      logger.log({ msg: 'after rotation' });

      // Old file should be renamed to .1
      expect(existsSync(logPath + '.1')).toBe(true);
      const rotatedSize = readFileSync(logPath + '.1', 'utf-8').length;
      expect(rotatedSize).toBe(bigContent.length);

      // New log file should only contain the new message
      const lines = readLogLines(logPath);
      expect(lines).toHaveLength(1);
      expect(lines[0].msg).toBe('after rotation');
    });

    it('does not rotate small files', () => {
      writeFileSync(logPath, 'small content');

      const logger = createLogger(logPath);
      logger.log({ msg: 'still small' });

      expect(existsSync(logPath + '.1')).toBe(false);
      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('small content');
      expect(content).toContain('still small');
    });
  });

  describe('error resilience', () => {
    it('survives file write errors gracefully', () => {
      const badPath = join(testDir, 'baddir');
      mkdirSync(badPath);
      const logger = createLogger(join(badPath));
      expect(() => logger.log({ msg: 'should not crash' })).not.toThrow();
    });
  });
});
