import type { Request, Response, NextFunction } from 'express';
import { validateApiKey, hasApiKey } from './keyManager';

/**
 * Auth mode:
 * - 'required': API key required for remote clients; loopback always trusted
 * - 'bootstrap-localhost-only': No key configured; allow loopback, reject others
 *
 * Loopback is trusted in both modes because this is a personal, single-user tool.
 * Cross-origin CSRF is mitigated by the CORS policy (restricted origins).
 */
export type AuthMode = 'required' | 'bootstrap-localhost-only';

/**
 * Paths that don't require authentication.
 * Only /health is public — needed for Bonjour health checks.
 */
export const PUBLIC_PATHS = ['/health'];

/**
 * Check if a remote address is a loopback address (127.0.0.1, ::1, or IPv4-mapped ::ffff:127.0.0.1)
 */
export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1'
  );
}

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

    // If no API key is configured, only allow loopback (bootstrap mode)
    if (!deps.hasApiKey()) {
      if (isLoopback(req.socket?.remoteAddress)) {
        next();
        return;
      }
      res.status(401).json({
        error: 'Unauthorized',
        message: 'API key not configured. Access restricted to localhost. Run "npm run key:generate" to enable remote access.'
      });
      return;
    }

    // Loopback is always trusted — the API key protects remote access (iOS app over network)
    if (isLoopback(req.socket?.remoteAddress)) {
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
