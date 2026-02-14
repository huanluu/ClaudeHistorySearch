import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express, { type Application } from 'express';
import request from 'supertest';
import { createRequestLogger, type RequestLoggerOptions } from '../src/provider/index.js';
import type { Logger, LogEntry } from '../src/provider/index.js';

function createMockLogger() {
  return {
    log: jest.fn<(entry: LogEntry) => void>(),
    error: jest.fn<(entry: LogEntry) => void>(),
    warn: jest.fn<(entry: LogEntry) => void>(),
    verbose: jest.fn<(entry: LogEntry) => void>(),
  };
}

function createTestApp(options: RequestLoggerOptions): Application {
  const app = express();
  app.use(createRequestLogger(options));

  app.get('/ok', (_req, res) => res.json({ status: 'ok' }));
  app.get('/not-found', (_req, res) => res.status(404).json({ error: 'not found' }));
  app.get('/error', (_req, res) => res.status(500).json({ error: 'internal' }));
  app.get('/with-query', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

describe('createRequestLogger', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  describe('level: "all"', () => {
    it('should log successful requests via logger.log()', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/ok');

      expect(mockLogger.log).toHaveBeenCalledTimes(1);
      const entry = mockLogger.log.mock.calls[0][0];
      expect(entry.op).toBe('http.request');
      expect(entry.msg).toBe('GET /ok 200');
      expect(entry.context?.method).toBe('GET');
      expect(entry.context?.path).toBe('/ok');
      expect(entry.context?.status).toBe(200);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should log 404 via logger.warn()', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/not-found');

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn.mock.calls[0][0].msg).toBe('GET /not-found 404');
    });

    it('should log 500 via logger.error()', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/error');

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error.mock.calls[0][0].msg).toBe('GET /error 500');
    });
  });

  describe('level: "errors-only"', () => {
    it('should NOT log successful requests', async () => {
      const app = createTestApp({ level: 'errors-only', logger: mockLogger });
      await request(app).get('/ok');

      expect(mockLogger.log).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should log 4xx errors', async () => {
      const app = createTestApp({ level: 'errors-only', logger: mockLogger });
      await request(app).get('/not-found');

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('should log 5xx errors', async () => {
      const app = createTestApp({ level: 'errors-only', logger: mockLogger });
      await request(app).get('/error');

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('level: "off"', () => {
    it('should not log anything', async () => {
      const app = createTestApp({ level: 'off', logger: mockLogger });
      await request(app).get('/ok');
      await request(app).get('/not-found');
      await request(app).get('/error');

      expect(mockLogger.log).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('query redaction', () => {
    it('should redact apiKey from query params', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/with-query?apiKey=secret123&q=hello');

      const entry = mockLogger.log.mock.calls[0][0];
      expect(entry.context?.query).toEqual({
        apiKey: '[REDACTED]',
        q: 'hello',
      });
    });

    it('should omit query from context when no query params', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/ok');

      const entry = mockLogger.log.mock.calls[0][0];
      expect(entry.context?.query).toBeUndefined();
    });
  });

  describe('dynamic level change', () => {
    it('should respect level changes at runtime', async () => {
      const options: RequestLoggerOptions = { level: 'all', logger: mockLogger };
      const app = createTestApp(options);

      await request(app).get('/ok');
      expect(mockLogger.log).toHaveBeenCalledTimes(1);

      options.level = 'off';
      mockLogger.log.mockClear();

      await request(app).get('/ok');
      expect(mockLogger.log).not.toHaveBeenCalled();
    });
  });

  describe('duration measurement', () => {
    it('should include durationMs in log entry', async () => {
      const app = createTestApp({ level: 'all', logger: mockLogger });
      await request(app).get('/ok');

      const entry = mockLogger.log.mock.calls[0][0];
      expect(typeof entry.durationMs).toBe('number');
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
