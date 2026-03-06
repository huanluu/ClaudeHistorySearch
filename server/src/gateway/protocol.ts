/**
 * Wire protocol — defines every message type between server and client.
 * This is the single source of truth for the server ↔ client contract.
 *
 * When adding a new message type:
 * 1. Add it to MessageType union and define its payload interface here
 * 2. Create a handler in the appropriate features/X/handlers.ts
 * 3. Register the handler in app.ts
 */

export type MessageType =
  | 'ping' | 'pong' | 'auth' | 'auth_result' | 'error' | 'message'
  | 'session.start' | 'session.cancel' | 'session.resume'
  | 'session.output' | 'session.error' | 'session.complete';

export interface WSMessage {
  type: MessageType;
  payload?: unknown;
  id?: string;
}

// ── Auth ────────────────────────────────────────────────────────────

export interface AuthPayload {
  apiKey: string;
}

export interface AuthResultPayload {
  success: boolean;
  message?: string;
}

// ── Session payloads ────────────────────────────────────────────────

export interface SessionStartPayload {
  sessionId: string;
  prompt: string;
  workingDir: string;
}

export interface SessionResumePayload extends SessionStartPayload {
  resumeSessionId: string;
}

export interface SessionCancelPayload {
  sessionId: string;
}

export interface SessionOutputPayload {
  sessionId: string;
  message: unknown;
}

export interface SessionErrorPayload {
  sessionId: string;
  error: string;
}

export interface SessionCompletePayload {
  sessionId: string;
  exitCode: number;
}

// ── Client abstraction ──────────────────────────────────────────────

/**
 * Represents an authenticated WebSocket client.
 * Features interact with clients through this interface — never raw WebSocket.
 */
export interface AuthenticatedClient {
  readonly clientId: string;
  send(message: WSMessage): void;
}
