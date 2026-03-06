import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the keyManager module BEFORE importing middleware
vi.mock('./keyManager', () => ({
  hasApiKey: vi.fn(),
  validateApiKey: vi.fn(),
}));

import { authMiddleware } from './middleware';
import { hasApiKey, validateApiKey } from './keyManager';

const mockHasApiKey = vi.mocked(hasApiKey);
const mockValidateApiKey = vi.mocked(validateApiKey);

function createMockReq(path: string, apiKey?: string): Partial<Request> {
  return {
    path,
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  };
}

function createMockRes(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn((code: number) => { res.statusCode = code; return res as Response; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res as Response; });
  return res;
}

describe('authMiddleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.resetAllMocks();
    next = vi.fn();
  });

  describe('public paths', () => {
    it('skips auth for /health', () => {
      const req = createMockReq('/health');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(mockHasApiKey).not.toHaveBeenCalled();
    });

    it('skips auth for /admin', () => {
      const req = createMockReq('/admin');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('does not skip auth for /admin/config (exact match, not startsWith)', () => {
      mockHasApiKey.mockReturnValue(true);
      const req = createMockReq('/admin/config');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('no API key configured', () => {
    it('calls next without checking auth when hasApiKey returns false', () => {
      mockHasApiKey.mockReturnValue(false);
      const req = createMockReq('/sessions');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(mockHasApiKey).toHaveBeenCalledTimes(1);
      expect(mockValidateApiKey).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('API key configured', () => {
    beforeEach(() => {
      mockHasApiKey.mockReturnValue(true);
    });

    it('returns 401 when X-API-Key header is missing', () => {
      const req = createMockReq('/sessions');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' })
      );
    });

    it('returns 401 when X-API-Key is invalid', () => {
      mockValidateApiKey.mockReturnValue(false);
      const req = createMockReq('/sessions', 'bad-key');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(mockValidateApiKey).toHaveBeenCalledWith('bad-key');
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' })
      );
    });

    it('calls next when X-API-Key is valid', () => {
      mockValidateApiKey.mockReturnValue(true);
      const req = createMockReq('/sessions', 'valid-key');
      const res = createMockRes();

      authMiddleware(req as Request, res as Response, next);

      expect(mockValidateApiKey).toHaveBeenCalledWith('valid-key');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
