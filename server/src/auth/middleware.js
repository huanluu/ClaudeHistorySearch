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
export function authMiddleware(req, res, next) {
  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }

  // If no API key is configured, allow all requests (first-run experience)
  if (!hasApiKey()) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Provide X-API-Key header.'
    });
  }

  if (!validateApiKey(apiKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key.'
    });
  }

  next();
}

export default authMiddleware;
