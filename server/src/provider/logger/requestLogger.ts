import type { Request, Response, NextFunction } from 'express';
import type { Logger } from './logger.js';

export type RequestLogLevel = 'off' | 'errors-only' | 'all';

export interface RequestLoggerOptions {
  level: RequestLogLevel;
  logger: Logger;
}

const SENSITIVE_QUERY_KEYS = new Set(['apikey', 'apiKey', 'key', 'token', 'secret']);

function redactQuery(query: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    result[k] = SENSITIVE_QUERY_KEYS.has(k) ? '[REDACTED]' : v;
  }
  return result;
}

/**
 * Express middleware that logs every HTTP request with structured data.
 * Reads `options.level` on each request so the level can be changed at runtime.
 */
export function createRequestLogger(options: RequestLoggerOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = performance.now();

    res.on('finish', () => {
      const level = options.level;
      if (level === 'off') return;

      const status = res.statusCode;
      const isError = status >= 400;

      if (level === 'errors-only' && !isError) return;

      const method = req.method;
      const path = req.path;
      const durationMs = Math.round(performance.now() - start);

      const context: Record<string, unknown> = { method, path, status };
      const queryKeys = Object.keys(req.query);
      if (queryKeys.length > 0) {
        context.query = redactQuery(req.query as Record<string, unknown>);
      }

      const entry = {
        op: 'http.request',
        msg: `${method} ${path} ${status}`,
        context,
        durationMs,
      };

      if (status >= 500) {
        options.logger.error(entry);
      } else if (status >= 400) {
        options.logger.warn(entry);
      } else {
        options.logger.log(entry);
      }
    });

    next();
  };
}
