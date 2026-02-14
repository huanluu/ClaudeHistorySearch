import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { URL } from 'url';
import { validateApiKey, hasApiKey, WorkingDirValidator, logger as defaultLogger } from '../provider/index.js';
import type { Logger } from '../provider/index.js';
import { SessionStore, SessionExecutor } from '../sessions/index.js';

/**
 * Message types for WebSocket communication
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

export interface AuthPayload {
  apiKey: string;
}

export interface AuthResultPayload {
  success: boolean;
  message?: string;
}

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

/**
 * Extended WebSocket with authentication state
 */
export interface AuthenticatedWebSocket extends WebSocket {
  isAuthenticated: boolean;
  clientId: string;
}

/**
 * Options for WebSocketTransport
 */
export interface WebSocketTransportOptions {
  /** HTTP server to attach to (required) */
  server: Server;
  /** Path for WebSocket connections (default: '/ws') */
  path?: string;
  /** Ping interval in ms (default: 30000) */
  pingInterval?: number;
  /** Working directory validator (optional, no validation if not set) */
  validator?: WorkingDirValidator;
  /** Logger instance */
  logger?: Logger;
  /** Message handler callback */
  onMessage?: (ws: AuthenticatedWebSocket, message: WSMessage) => void;
  /** Connection handler callback */
  onConnection?: (ws: AuthenticatedWebSocket) => void;
  /** Disconnection handler callback */
  onDisconnection?: (ws: AuthenticatedWebSocket) => void;
}

/**
 * WebSocketTransport - WebSocket transport implementation
 *
 * Attaches to an existing HTTP server and handles WebSocket connections
 * with API key authentication. Supports ping/pong keepalive.
 *
 * Authentication flow:
 * 1. Client connects to ws://host:port/ws?apiKey=xxx
 * 2. Server validates API key from query string
 * 3. If valid, connection is authenticated and can send/receive messages
 * 4. If invalid, server sends error and closes connection
 */
export class WebSocketTransport {
  private wss: WebSocketServer | null = null;
  private server: Server;
  private path: string;
  private pingInterval: number;
  private pingTimer: NodeJS.Timeout | null = null;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private sessionStore: SessionStore = new SessionStore();
  private validator?: WorkingDirValidator;
  private logger: Logger;

  // Event handlers
  private onMessage?: (ws: AuthenticatedWebSocket, message: WSMessage) => void;
  private onConnection?: (ws: AuthenticatedWebSocket) => void;
  private onDisconnection?: (ws: AuthenticatedWebSocket) => void;

  public isRunning = false;

  constructor(options: WebSocketTransportOptions) {
    this.server = options.server;
    this.path = options.path ?? '/ws';
    this.pingInterval = options.pingInterval ?? 30000;
    this.validator = options.validator;
    this.logger = options.logger ?? defaultLogger;
    this.onMessage = options.onMessage;
    this.onConnection = options.onConnection;
    this.onDisconnection = options.onDisconnection;
  }

  /**
   * Set or update the working directory validator (for hot-reload)
   */
  setValidator(validator: WorkingDirValidator): void {
    this.validator = validator;
  }

  /**
   * Start the WebSocket server
   */
  start(): void {
    if (this.isRunning) {
      throw new Error('WebSocket transport is already running');
    }

    this.wss = new WebSocketServer({
      server: this.server,
      path: this.path,
      verifyClient: this._verifyClient.bind(this)
    });

    this.wss.on('connection', this._handleConnection.bind(this));
    this.wss.on('error', (error) => {
      this.logger.error({ msg: `Server error: ${(error as Error).message}`, op: 'ws.error', err: error });
    });

    // Start ping interval
    this._startPingInterval();

    this.isRunning = true;
    this.logger.log({ msg: `Server started on path ${this.path}`, op: 'ws.connect', context: { path: this.path } });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.wss) {
      return;
    }

    // Stop ping interval
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Close all client connections
    for (const client of this.clients) {
      client.close(1000, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    return new Promise<void>((resolve, reject) => {
      this.wss!.close((err) => {
        this.isRunning = false;
        this.wss = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Broadcast a message to all authenticated clients
   */
  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.isAuthenticated && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Send a message to a specific client
   */
  send(ws: AuthenticatedWebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get all connected clients
   */
  getClients(): Set<AuthenticatedWebSocket> {
    return this.clients;
  }

  /**
   * Verify client connection (authentication via query parameter)
   */
  private _verifyClient(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    // If no API key is configured, allow all connections
    if (!hasApiKey()) {
      callback(true);
      return;
    }

    // Extract API key from query string
    const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
    const apiKey = url.searchParams.get('apiKey');

    if (!apiKey) {
      callback(false, 401, 'API key required');
      return;
    }

    if (!validateApiKey(apiKey)) {
      callback(false, 401, 'Invalid API key');
      return;
    }

    callback(true);
  }

  /**
   * Handle new WebSocket connection
   */
  private _handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const authenticatedWs = ws as AuthenticatedWebSocket;
    authenticatedWs.isAuthenticated = true; // Already verified in verifyClient
    authenticatedWs.clientId = this._generateClientId();

    this.clients.add(authenticatedWs);
    this.logger.log({ msg: `Client connected: ${authenticatedWs.clientId}`, op: 'ws.connect', context: { clientId: authenticatedWs.clientId } });

    // Send auth success
    this.send(authenticatedWs, {
      type: 'auth_result',
      payload: { success: true } as AuthResultPayload
    });

    // Notify connection handler
    this.onConnection?.(authenticatedWs);

    // Handle messages
    ws.on('message', (data) => {
      this._handleMessage(authenticatedWs, data);
    });

    // Handle close
    ws.on('close', () => {
      this.clients.delete(authenticatedWs);
      this.logger.log({ msg: `Client disconnected: ${authenticatedWs.clientId}`, op: 'ws.disconnect', context: { clientId: authenticatedWs.clientId } });

      // Cancel all sessions for this client
      const sessions = this.sessionStore.removeByClient(authenticatedWs.clientId);
      for (const executor of sessions) {
        executor.cancel();
      }

      this.onDisconnection?.(authenticatedWs);
    });

    // Handle errors
    ws.on('error', (error) => {
      this.logger.error({ msg: `Client error (${authenticatedWs.clientId}): ${(error as Error).message}`, op: 'ws.error', err: error, context: { clientId: authenticatedWs.clientId } });
    });

    // Handle pong responses
    ws.on('pong', () => {
      // Client is alive - could track this for connection health
    });
  }

  /**
   * Handle incoming message from client
   */
  private _handleMessage(ws: AuthenticatedWebSocket, data: RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WSMessage;

      // Handle ping/pong at transport level
      if (message.type === 'ping') {
        this.send(ws, { type: 'pong', id: message.id });
        return;
      }

      // Handle session messages
      if (message.type === 'session.start') {
        this._handleSessionStart(ws, message.payload as SessionStartPayload);
        return;
      }

      if (message.type === 'session.resume') {
        this._handleSessionResume(ws, message.payload as SessionResumePayload);
        return;
      }

      if (message.type === 'session.cancel') {
        this._handleSessionCancel(ws, message.payload as SessionCancelPayload);
        return;
      }

      // Delegate other messages to handler
      this.onMessage?.(ws, message);
    } catch (error) {
      this.logger.error({ msg: `Failed to parse message: ${(error as Error).message}`, op: 'ws.error', err: error });
      this.send(ws, {
        type: 'error',
        payload: { message: 'Invalid message format' }
      });
    }
  }

  /**
   * Handle session.start message
   */
  private _handleSessionStart(ws: AuthenticatedWebSocket, payload: SessionStartPayload): void {
    this.logger.log({
      msg: `session.start received: sessionId=${payload.sessionId}`,
      op: 'ws.message',
      context: { sessionId: payload.sessionId, promptPreview: payload.prompt.substring(0, 50) },
    });

    // Validate working directory
    const workingDir = this._validateWorkingDir(ws, payload.sessionId, payload.workingDir);
    if (!workingDir) return;

    const executor = this.sessionStore.create(payload.sessionId, ws.clientId);
    this._wireSessionEvents(ws, executor, payload.sessionId);

    executor.start({
      prompt: payload.prompt,
      workingDir
    });
    this.logger.log({ msg: `session.start: executor started`, op: 'ws.message', context: { sessionId: payload.sessionId } });
  }

  /**
   * Handle session.resume message
   */
  private _handleSessionResume(ws: AuthenticatedWebSocket, payload: SessionResumePayload): void {
    this.logger.log({
      msg: `session.resume received: sessionId=${payload.sessionId}, resumeSessionId=${payload.resumeSessionId}`,
      op: 'ws.message',
      context: { sessionId: payload.sessionId, resumeSessionId: payload.resumeSessionId },
    });

    // Validate working directory
    const workingDir = this._validateWorkingDir(ws, payload.sessionId, payload.workingDir);
    if (!workingDir) return;

    const executor = this.sessionStore.create(payload.sessionId, ws.clientId);
    this._wireSessionEvents(ws, executor, payload.sessionId);

    executor.start({
      prompt: payload.prompt,
      workingDir,
      resumeSessionId: payload.resumeSessionId
    });
    this.logger.log({ msg: `session.resume: executor started`, op: 'ws.message', context: { sessionId: payload.sessionId } });
  }

  /**
   * Handle session.cancel message
   */
  private _handleSessionCancel(_ws: AuthenticatedWebSocket, payload: SessionCancelPayload): void {
    const executor = this.sessionStore.get(payload.sessionId);
    if (executor) {
      executor.cancel();
    }
  }

  /**
   * Validate working directory against the allowlist.
   * Returns the resolved path if valid, or null if rejected (sends session.error).
   */
  private _validateWorkingDir(ws: AuthenticatedWebSocket, sessionId: string, workingDir: string): string | null {
    if (!this.validator) {
      return workingDir; // No validator configured, allow all (backwards-compatible)
    }

    const result = this.validator.validate(workingDir);
    if (!result.allowed) {
      this.logger.log({ msg: `Working directory rejected: ${workingDir} - ${result.error}`, op: 'ws.message', context: { workingDir, error: result.error } });
      this.send(ws, {
        type: 'session.error',
        payload: { sessionId, error: result.error } as SessionErrorPayload
      });
      return null;
    }

    return result.resolvedPath ?? workingDir;
  }

  /**
   * Wire up session executor events to WebSocket messages
   */
  private _wireSessionEvents(ws: AuthenticatedWebSocket, executor: SessionExecutor, sessionId: string): void {
    this.logger.verbose({ msg: `Wiring session events for: ${sessionId}`, op: 'ws.message', context: { sessionId } });

    executor.on('message', (message: unknown) => {
      this.logger.verbose({ msg: `session.output for ${sessionId}`, op: 'ws.message', context: { sessionId } });
      this.send(ws, {
        type: 'session.output',
        payload: { sessionId, message } as SessionOutputPayload
      });
    });

    executor.on('error', (error: string) => {
      this.logger.log({ msg: `session.error for ${sessionId}: ${error}`, op: 'ws.message', context: { sessionId, error } });
      this.send(ws, {
        type: 'session.error',
        payload: { sessionId, error } as SessionErrorPayload
      });
    });

    executor.on('complete', (exitCode: number) => {
      this.logger.log({ msg: `session.complete for ${sessionId}: exitCode=${exitCode}`, op: 'ws.message', context: { sessionId, exitCode } });
      this.send(ws, {
        type: 'session.complete',
        payload: { sessionId, exitCode } as SessionCompletePayload
      });
      this.sessionStore.remove(sessionId);
    });
  }

  /**
   * Start ping interval to keep connections alive
   */
  private _startPingInterval(): void {
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, this.pingInterval);
  }

  /**
   * Generate a unique client ID
   */
  private _generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

export default WebSocketTransport;
