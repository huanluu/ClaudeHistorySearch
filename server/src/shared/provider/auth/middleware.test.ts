import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthMiddleware, type AuthDeps, PUBLIC_PATHS } from './middleware';

// No vi.mock needed — dependencies are injected via createAuthMiddleware

function createMockReq(path: string, options?: { apiKey?: string; remoteAddress?: string }): Partial<Request> {
  return {
    path,
    headers: options?.apiKey ? { 'x-api-key': options.apiKey } : {},
    socket: { remoteAddress: options?.remoteAddress ?? '192.168.1.100' } as Request['socket'],
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
  let mockHasApiKey: AuthDeps['hasApiKey'] & Mock;
  let mockValidateApiKey: AuthDeps['validateApiKey'] & Mock;
  let middleware: ReturnType<typeof createAuthMiddleware>;

  beforeEach(() => {
    mockHasApiKey = vi.fn(() => false);
    mockValidateApiKey = vi.fn(() => false);
    middleware = createAuthMiddleware({
      hasApiKey: mockHasApiKey,
      validateApiKey: mockValidateApiKey,
    });
    next = vi.fn();
  });

  describe('public paths', () => {
    it('skips auth for /health', () => {
      const req = createMockReq('/health');
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(mockHasApiKey).not.toHaveBeenCalled();
    });

    it('/admin is NOT in PUBLIC_PATHS', () => {
      expect(PUBLIC_PATHS).toEqual(['/health']);
      expect(PUBLIC_PATHS).not.toContain('/admin');
    });

    it('does not skip auth for /admin/config (exact match, not startsWith)', () => {
      mockHasApiKey.mockReturnValue(true);
      const req = createMockReq('/admin/config');
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe('no API key configured — bootstrap mode', () => {
    beforeEach(() => {
      mockHasApiKey.mockReturnValue(false);
    });

    it('allows loopback IPv4 (127.0.0.1) without key', () => {
      const req = createMockReq('/sessions', { remoteAddress: '127.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows loopback IPv6 (::1) without key', () => {
      const req = createMockReq('/sessions', { remoteAddress: '::1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows IPv4-mapped loopback (::ffff:127.0.0.1) without key', () => {
      const req = createMockReq('/sessions', { remoteAddress: '::ffff:127.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects non-loopback IP without key', () => {
      const req = createMockReq('/sessions', { remoteAddress: '192.168.1.100' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects non-loopback IP for /admin without key', () => {
      const req = createMockReq('/admin', { remoteAddress: '192.168.1.100' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('/health is always public regardless of source IP', () => {
      const req = createMockReq('/health', { remoteAddress: '10.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

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

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' })
      );
    });

    it('returns 401 when X-API-Key is invalid', () => {
      mockValidateApiKey.mockReturnValue(false);
      const req = createMockReq('/sessions', { apiKey: 'bad-key' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(mockValidateApiKey).toHaveBeenCalledWith('bad-key');
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Unauthorized' })
      );
    });

    it('calls next when X-API-Key is valid', () => {
      mockValidateApiKey.mockReturnValue(true);
      const req = createMockReq('/sessions', { apiKey: 'valid-key' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(mockValidateApiKey).toHaveBeenCalledWith('valid-key');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('returns 401 for /admin without key', () => {
      const req = createMockReq('/admin');
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('allows /admin with valid key', () => {
      mockValidateApiKey.mockReturnValue(true);
      const req = createMockReq('/admin', { apiKey: 'valid-key' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('allows loopback IPv4 (127.0.0.1) without key when API key configured', () => {
      const req = createMockReq('/sessions', { remoteAddress: '127.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows loopback IPv6 (::1) without key when API key configured', () => {
      const req = createMockReq('/sessions', { remoteAddress: '::1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows loopback IPv4-mapped (::ffff:127.0.0.1) without key when API key configured', () => {
      const req = createMockReq('/sessions', { remoteAddress: '::ffff:127.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('allows /admin from loopback without key when API key configured', () => {
      const req = createMockReq('/admin', { remoteAddress: '127.0.0.1' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('still rejects non-loopback without key when API key configured', () => {
      const req = createMockReq('/sessions', { remoteAddress: '192.168.1.100' });
      const res = createMockRes();

      middleware(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
