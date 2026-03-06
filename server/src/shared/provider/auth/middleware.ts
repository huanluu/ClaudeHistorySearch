import type { Request, Response, NextFunction } from 'express';
import { validateApiKey, hasApiKey } from './keyManager';

/**
 * Paths that don't require authentication
 * - /health is needed for Bonjour health checks
 */
const PUBLIC_PATHS = ['/health', '/admin'];

export interface AuthDeps {
  hasApiKey: () => boolean;
  validateApiKey: (key: string | string[] | undefined) => boolean;
}

/**
 * Factory that creates auth middleware with injected dependencies.
 * Enables testing without vi.mock by passing fake implementations.
 */
export function createAuthMiddleware(deps: AuthDeps) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for public paths
    if (PUBLIC_PATHS.includes(req.path)) {
      next();
      return;
    }

    // If no API key is configured, allow all requests (first-run experience)
    if (!deps.hasApiKey()) {
      next();
      return;
    }

    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Provide X-API-Key header.'
      });
      return;
    }

    if (!deps.validateApiKey(apiKey)) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key.'
      });
      return;
    }

    next();
  };
}

/** Default middleware using real keyManager functions (backward compatible) */
export const authMiddleware = createAuthMiddleware({ hasApiKey, validateApiKey });
export default authMiddleware;
