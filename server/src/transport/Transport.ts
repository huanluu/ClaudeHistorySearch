import type { Server } from 'http';

/**
 * Options for configuring a Transport
 */
export interface TransportOptions {
  port?: number;
  onRequest?: () => void;
}

/**
 * Request context passed to handlers
 */
export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  send: (statusCode: number, data: unknown) => void;
  json: (data: unknown) => void;
  error: (statusCode: number, message: string) => void;
}

/**
 * Transport - Abstract base class for server transports
 *
 * Transports handle the communication layer (HTTP, WebSocket, etc.)
 * while delegating request handling to the application layer.
 */
export abstract class Transport {
  protected port: number;
  protected onRequest: () => void;
  public isRunning: boolean;

  constructor(options: TransportOptions = {}) {
    this.port = options.port ?? 3847;
    this.onRequest = options.onRequest ?? (() => {});
    this.isRunning = false;
  }

  /**
   * Start the transport server
   */
  abstract start(): Promise<void>;

  /**
   * Stop the transport server
   */
  abstract stop(): Promise<void>;

  /**
   * Get the underlying server instance (for attaching WebSocket, etc.)
   */
  getServer(): Server | null {
    return null;
  }

  /**
   * Register middleware (transport-specific)
   */
  abstract use(...args: unknown[]): void;
}

export default Transport;
