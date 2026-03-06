import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  AuthPayloadSchema,
  SessionStartPayloadSchema,
  SessionResumePayloadSchema,
  SessionCancelPayloadSchema,
  SearchQuerySchema,
  SessionsQuerySchema,
} from './schemas';

describe('WebSocket payload schemas', () => {
  describe('AuthPayloadSchema', () => {
    it('accepts valid auth payload', () => {
      const result = AuthPayloadSchema.parse({ apiKey: 'test-key-123' });
      expect(result).toEqual({ apiKey: 'test-key-123' });
    });

    it('rejects missing apiKey', () => {
      expect(() => AuthPayloadSchema.parse({})).toThrow(ZodError);
    });

    it('rejects non-string apiKey', () => {
      expect(() => AuthPayloadSchema.parse({ apiKey: 123 })).toThrow(ZodError);
    });

    it('strips extra fields', () => {
      const result = AuthPayloadSchema.parse({ apiKey: 'key', extra: 'field' });
      expect(result).toEqual({ apiKey: 'key' });
    });
  });

  describe('SessionStartPayloadSchema', () => {
    const validPayload = {
      sessionId: 'sess-123',
      prompt: 'Hello world',
      workingDir: '/Users/test/project',
    };

    it('accepts valid payload', () => {
      const result = SessionStartPayloadSchema.parse(validPayload);
      expect(result).toEqual({ ...validPayload, source: 'claude' });
    });

    it('rejects missing sessionId', () => {
      const { sessionId: _, ...partial } = validPayload;
      expect(() => SessionStartPayloadSchema.parse(partial)).toThrow(ZodError);
    });

    it('rejects missing prompt', () => {
      const { prompt: _, ...partial } = validPayload;
      expect(() => SessionStartPayloadSchema.parse(partial)).toThrow(ZodError);
    });

    it('rejects missing workingDir', () => {
      const { workingDir: _, ...partial } = validPayload;
      expect(() => SessionStartPayloadSchema.parse(partial)).toThrow(ZodError);
    });

    it('rejects non-string sessionId', () => {
      expect(() => SessionStartPayloadSchema.parse({ ...validPayload, sessionId: 123 })).toThrow(ZodError);
    });

    it('strips extra fields', () => {
      const result = SessionStartPayloadSchema.parse({ ...validPayload, extra: true });
      expect(result).toEqual({ ...validPayload, source: 'claude' });
    });

    it('rejects null payload', () => {
      expect(() => SessionStartPayloadSchema.parse(null)).toThrow(ZodError);
    });

    it('rejects undefined payload', () => {
      expect(() => SessionStartPayloadSchema.parse(undefined)).toThrow(ZodError);
    });
  });

  describe('SessionResumePayloadSchema', () => {
    const validPayload = {
      sessionId: 'sess-123',
      prompt: 'Continue',
      workingDir: '/Users/test/project',
      resumeSessionId: 'prev-sess-456',
    };

    it('accepts valid payload', () => {
      const result = SessionResumePayloadSchema.parse(validPayload);
      expect(result).toEqual({ ...validPayload, source: 'claude' });
    });

    it('rejects missing resumeSessionId', () => {
      const { resumeSessionId: _, ...partial } = validPayload;
      expect(() => SessionResumePayloadSchema.parse(partial)).toThrow(ZodError);
    });

    it('rejects non-string resumeSessionId', () => {
      expect(() => SessionResumePayloadSchema.parse({ ...validPayload, resumeSessionId: 42 })).toThrow(ZodError);
    });
  });

  describe('SessionCancelPayloadSchema', () => {
    it('accepts valid payload', () => {
      const result = SessionCancelPayloadSchema.parse({ sessionId: 'sess-123' });
      expect(result).toEqual({ sessionId: 'sess-123' });
    });

    it('rejects missing sessionId', () => {
      expect(() => SessionCancelPayloadSchema.parse({})).toThrow(ZodError);
    });

    it('rejects non-string sessionId', () => {
      expect(() => SessionCancelPayloadSchema.parse({ sessionId: 42 })).toThrow(ZodError);
    });
  });
});

describe('HTTP query schemas', () => {
  describe('SearchQuerySchema', () => {
    it('accepts valid search query', () => {
      const result = SearchQuerySchema.parse({ q: 'hello' });
      expect(result).toEqual({ q: 'hello', limit: 50, offset: 0, sort: 'relevance' });
    });

    it('accepts all optional params', () => {
      const result = SearchQuerySchema.parse({ q: 'test', limit: '10', offset: '5', sort: 'date', automatic: 'true' });
      expect(result).toEqual({ q: 'test', limit: 10, offset: 5, sort: 'date', automatic: 'true' });
    });

    it('rejects empty query string', () => {
      expect(() => SearchQuerySchema.parse({ q: '' })).toThrow(ZodError);
    });

    it('rejects missing q parameter', () => {
      expect(() => SearchQuerySchema.parse({})).toThrow(ZodError);
    });

    it('rejects negative limit', () => {
      expect(() => SearchQuerySchema.parse({ q: 'test', limit: '-1' })).toThrow(ZodError);
    });

    it('rejects limit exceeding maximum', () => {
      expect(() => SearchQuerySchema.parse({ q: 'test', limit: '300' })).toThrow(ZodError);
    });

    it('rejects negative offset', () => {
      expect(() => SearchQuerySchema.parse({ q: 'test', offset: '-5' })).toThrow(ZodError);
    });

    it('rejects invalid sort value', () => {
      expect(() => SearchQuerySchema.parse({ q: 'test', sort: 'alphabetical' })).toThrow(ZodError);
    });

    it('coerces string numbers to numbers', () => {
      const result = SearchQuerySchema.parse({ q: 'test', limit: '25', offset: '10' });
      expect(result.limit).toBe(25);
      expect(result.offset).toBe(10);
    });
  });

  describe('SessionsQuerySchema', () => {
    it('accepts empty query (all defaults)', () => {
      const result = SessionsQuerySchema.parse({});
      expect(result).toEqual({ limit: 20, offset: 0 });
    });

    it('accepts valid params', () => {
      const result = SessionsQuerySchema.parse({ limit: '50', offset: '10', automatic: 'true' });
      expect(result).toEqual({ limit: 50, offset: 10, automatic: 'true' });
    });

    it('rejects limit exceeding maximum', () => {
      expect(() => SessionsQuerySchema.parse({ limit: '200' })).toThrow(ZodError);
    });

    it('rejects negative offset', () => {
      expect(() => SessionsQuerySchema.parse({ offset: '-1' })).toThrow(ZodError);
    });

    it('rejects non-integer limit', () => {
      expect(() => SessionsQuerySchema.parse({ limit: '3.5' })).toThrow(ZodError);
    });
  });
});
