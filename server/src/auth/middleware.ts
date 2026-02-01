import type { Request, Response, NextFunction } from 'express';
import { validateApiKey, hasApiKey } from './keyManager.js';

/**
 * Paths that don't require authentication
 * - /health is needed for Bonjour health checks
 */
const PUBLIC_PATHS = ['/health'];

/**
 * Express middleware for API key authentication
 * Validates X-API-Key header against stored key hash
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(req.path)) {
    next();
    return;
  }

  // If no API key is configured, allow all requests (first-run experience)
  if (!hasApiKey()) {
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

  if (!validateApiKey(apiKey)) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key.'
    });
    return;
  }

  next();
}

export default authMiddleware;
