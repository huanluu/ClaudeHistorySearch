/**
 * Gateway interface types — defines how features register handlers and interact with the gateway.
 * Features import these as types only; actual gateway instances are injected via app.ts.
 */

import type { AuthenticatedClient, WSMessage } from './protocol';

/**
 * Handler for a validated WebSocket message payload.
 * Payloads are Zod-validated by the gateway before reaching handlers.
 */
export type WsHandler<T = unknown> = (client: AuthenticatedClient, payload: T, messageId?: string) => void;
export type WsConnectionHandler = (client: AuthenticatedClient) => void;

/**
 * Interface that features use to register WebSocket handlers.
 * Features receive this via constructor injection from app.ts.
 */
export interface WsGateway {
  /** Register a handler for a specific message type (e.g., 'session.start') */
  on<T = unknown>(type: string, handler: WsHandler<T>): void;

  /** Register a callback for new client connections */
  onConnect(handler: WsConnectionHandler): void;

  /** Register a callback for client disconnections */
  onDisconnect(handler: WsConnectionHandler): void;

  /** Start the WebSocket server */
  start(): void;

  /** Stop the WebSocket server */
  stop(): Promise<void>;

  /** Number of connected clients */
  getClientCount(): number;

  /** Broadcast a message to all authenticated clients */
  broadcast(message: WSMessage): void;
}
