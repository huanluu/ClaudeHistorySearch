/**
 * Express middleware for HTTP request validation using Zod schemas.
 * Applied at the gateway layer so feature routes only see validated data.
 *
 * Validated data is attached to `res.locals.validated` to avoid
 * re-parsing in feature handlers.
 */

import { type RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

/**
 * Create middleware that validates `req.query` against a Zod schema.
 * On success, stores the parsed result in `res.locals.validated.query`.
 * On failure, returns a 400 with structured error details.
 */
export function validateQuery(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.query);
      res.locals.validated = { ...res.locals.validated, query: validated };
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ).join('; ');
        res.status(400).json({ error: `Validation error: ${details}` });
        return;
      }
      next(error);
    }
  };
}

/**
 * Create middleware that validates `req.body` against a Zod schema.
 * On success, stores the parsed result in `res.locals.validated.body`.
 * On failure, returns a 400 with structured error details.
 */
export function validateBody(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    try {
      const validated = schema.parse(req.body);
      res.locals.validated = { ...res.locals.validated, body: validated };
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ).join('; ');
        res.status(400).json({ error: `Validation error: ${details}` });
        return;
      }
      next(error);
    }
  };
}
