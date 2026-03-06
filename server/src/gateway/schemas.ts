/**
 * Zod schemas for all inbound WebSocket message payloads.
 * Validates external input at the gateway boundary before it reaches feature handlers.
 *
 * Only inbound (client → server) messages need schemas.
 * Outbound messages (server → client) are trusted — we control them.
 */

import { z } from 'zod';
import type { MessageType } from './protocol';

// ── Inbound payload schemas ────────────────────────────────────────

export const AuthPayloadSchema = z.object({
  apiKey: z.string(),
});

export const SessionStartPayloadSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
  workingDir: z.string(),
});

export const SessionResumePayloadSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
  workingDir: z.string(),
  resumeSessionId: z.string(),
});

export const SessionCancelPayloadSchema = z.object({
  sessionId: z.string(),
});

// ping has no payload — validated separately in the gateway

// ── Schema registry ────────────────────────────────────────────────

/**
 * Maps inbound message types to their payload schemas.
 * Message types not in this map either have no payload (ping)
 * or are outbound-only (session.output, session.error, etc.).
 */
// Note: 'auth' is not listed here — auth is validated during WebSocket upgrade
// in _verifyClient, not via _handleMessage dispatch.
export const payloadSchemas: Partial<Record<MessageType, z.ZodType>> = {
  'session.start': SessionStartPayloadSchema,
  'session.resume': SessionResumePayloadSchema,
  'session.cancel': SessionCancelPayloadSchema,
};

// ── HTTP query param schemas ───────────────────────────────────────

export const SearchQuerySchema = z.object({
  q: z.string().min(1, 'Search query is required'),
  limit: z.coerce.number().int().min(0).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sort: z.enum(['relevance', 'date']).optional().default('relevance'),
  automatic: z.enum(['true', 'false']).optional(),
});

export const SessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  automatic: z.enum(['true', 'false']).optional(),
});

// Intentionally permissive: ConfigService.updateSection() does its own
// field-level validation with allowlists per section. This schema only
// ensures the body is a JSON object (rejects arrays, strings, null).
export const ConfigUpdateBodySchema = z.record(z.string(), z.unknown());

// ── Validated types (inferred from schemas — no manual interfaces needed) ──

export type ValidatedSessionStartPayload = z.infer<typeof SessionStartPayloadSchema>;
export type ValidatedSessionResumePayload = z.infer<typeof SessionResumePayloadSchema>;
export type ValidatedSessionCancelPayload = z.infer<typeof SessionCancelPayloadSchema>;
export type ValidatedSearchQuery = z.infer<typeof SearchQuerySchema>;
export type ValidatedSessionsQuery = z.infer<typeof SessionsQuerySchema>;
