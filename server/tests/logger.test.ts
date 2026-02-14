import { jest } from '@jest/globals';
import { createLogger } from '../src/provider/index.js';
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

describe('Logger', () => {
  describe('.log()', () => {
    it('writes with timestamp and [LOG] tag', () => {
      const logger = createLogger(logPath, { console: false });
      logger.log('hello world');

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[LOG\] hello world\n$/);
    });
  });

  describe('.error()', () => {
    it('writes with [ERROR] tag', () => {
      const logger = createLogger(logPath, { console: false });
      logger.error('something broke');

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('[ERROR] something broke');
    });
  });

  describe('.warn()', () => {
    it('writes with [WARN] tag', () => {
      const logger = createLogger(logPath, { console: false });
      logger.warn('be careful');

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('[WARN] be careful');
    });
  });

  describe('.verbose()', () => {
    it('writes nothing when verbose is disabled', () => {
      const logger = createLogger(logPath, { console: false, verbose: false });
      logger.verbose('should not appear');

      expect(existsSync(logPath)).toBe(false);
    });

    it('writes with [VERBOSE] tag when enabled', () => {
      const logger = createLogger(logPath, { console: false, verbose: true });
      logger.verbose('detailed info');

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('[VERBOSE] detailed info');
    });
  });

  describe('formatting', () => {
    it('formats multiple arguments like console.log', () => {
      const logger = createLogger(logPath, { console: false });
      logger.log('count:', 42, 'items');

      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('[LOG] count: 42 items');
    });
  });

  describe('file operations', () => {
    it('appends to existing file', () => {
      const logger = createLogger(logPath, { console: false });
      logger.log('first');
      logger.log('second');

      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('first');
      expect(lines[1]).toContain('second');
    });

    it('creates parent directory if missing', () => {
      const nestedPath = join(testDir, 'nested', 'deep', 'test.log');
      const logger = createLogger(nestedPath, { console: false });
      logger.log('created dir');

      const content = readFileSync(nestedPath, 'utf-8');
      expect(content).toContain('created dir');
    });
  });

  describe('rotation', () => {
    it('rotates when file exceeds 10 MB', () => {
      // Create a file larger than 10 MB
      const bigContent = 'x'.repeat(11 * 1024 * 1024);
      writeFileSync(logPath, bigContent);

      // Creating the logger triggers rotation at startup
      const logger = createLogger(logPath, { console: false });
      logger.log('after rotation');

      // Old file should be renamed to .1
      expect(existsSync(logPath + '.1')).toBe(true);
      const rotatedSize = readFileSync(logPath + '.1', 'utf-8').length;
      expect(rotatedSize).toBe(bigContent.length);

      // New log file should only contain the new message
      const newContent = readFileSync(logPath, 'utf-8');
      expect(newContent).toContain('after rotation');
      expect(newContent.length).toBeLessThan(200);
    });

    it('does not rotate small files', () => {
      writeFileSync(logPath, 'small content');

      const logger = createLogger(logPath, { console: false });
      logger.log('still small');

      expect(existsSync(logPath + '.1')).toBe(false);
      const content = readFileSync(logPath, 'utf-8');
      expect(content).toContain('small content');
      expect(content).toContain('still small');
    });
  });

  describe('error resilience', () => {
    it('survives file write errors gracefully', () => {
      // Point to a path that can't be written (directory as file)
      const badPath = join(testDir, 'baddir');
      mkdirSync(badPath);
      const impossiblePath = join(badPath, 'subdir', 'that', 'is', 'actually', 'a', 'dir');
      // We can't easily make appendFileSync fail, but we can at least verify it doesn't throw
      // by using a path where the parent exists but is not writable
      // Instead, let's just verify the logger doesn't crash
      const logger = createLogger(join(badPath), { console: false });
      expect(() => logger.log('should not crash')).not.toThrow();
    });
  });

  describe('console output', () => {
    it('also writes to console when enabled', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const logger = createLogger(logPath, { console: true });

        logger.log('console test');
        expect(consoleSpy).toHaveBeenCalledWith('console test');

        logger.error('error test');
        expect(errorSpy).toHaveBeenCalledWith('error test');

        logger.warn('warn test');
        expect(warnSpy).toHaveBeenCalledWith('warn test');
      } finally {
        consoleSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
