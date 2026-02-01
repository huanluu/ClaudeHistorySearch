import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { URL } from 'url';
import { validateApiKey, hasApiKey } from '../auth/keyManager.js';
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

  // Event handlers
  private onMessage?: (ws: AuthenticatedWebSocket, message: WSMessage) => void;
  private onConnection?: (ws: AuthenticatedWebSocket) => void;
  private onDisconnection?: (ws: AuthenticatedWebSocket) => void;

  public isRunning = false;

  constructor(options: WebSocketTransportOptions) {
    this.server = options.server;
    this.path = options.path ?? '/ws';
    this.pingInterval = options.pingInterval ?? 30000;
    this.onMessage = options.onMessage;
    this.onConnection = options.onConnection;
    this.onDisconnection = options.onDisconnection;
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
      console.error('[WebSocket] Server error:', error);
    });

    // Start ping interval
    this._startPingInterval();

    this.isRunning = true;
    console.log(`[WebSocket] Server started on path ${this.path}`);
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
    console.log(`[WebSocket] Client connected: ${authenticatedWs.clientId}`);

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
      console.log(`[WebSocket] Client disconnected: ${authenticatedWs.clientId}`);

      // Cancel all sessions for this client
      const sessions = this.sessionStore.removeByClient(authenticatedWs.clientId);
      for (const executor of sessions) {
        executor.cancel();
      }

      this.onDisconnection?.(authenticatedWs);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WebSocket] Client error (${authenticatedWs.clientId}):`, error);
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
      console.error('[WebSocket] Failed to parse message:', error);
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
    console.log(`[WebSocket] session.start received: sessionId=${payload.sessionId}, prompt="${payload.prompt.substring(0, 50)}..."`);
    const executor = this.sessionStore.create(payload.sessionId, ws.clientId);
    this._wireSessionEvents(ws, executor, payload.sessionId);

    executor.start({
      prompt: payload.prompt,
      workingDir: payload.workingDir
    });
    console.log(`[WebSocket] session.start: executor started`);
  }

  /**
   * Handle session.resume message
   */
  private _handleSessionResume(ws: AuthenticatedWebSocket, payload: SessionResumePayload): void {
    console.log(`[WebSocket] session.resume received: sessionId=${payload.sessionId}, resumeSessionId=${payload.resumeSessionId}`);
    const executor = this.sessionStore.create(payload.sessionId, ws.clientId);
    this._wireSessionEvents(ws, executor, payload.sessionId);

    executor.start({
      prompt: payload.prompt,
      workingDir: payload.workingDir,
      resumeSessionId: payload.resumeSessionId
    });
    console.log(`[WebSocket] session.resume: executor started`);
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
   * Wire up session executor events to WebSocket messages
   */
  private _wireSessionEvents(ws: AuthenticatedWebSocket, executor: SessionExecutor, sessionId: string): void {
    console.log(`[WebSocket] Wiring session events for: ${sessionId}`);

    executor.on('message', (message: unknown) => {
      console.log(`[WebSocket] session.output for ${sessionId}:`, JSON.stringify(message).substring(0, 100));
      this.send(ws, {
        type: 'session.output',
        payload: { sessionId, message } as SessionOutputPayload
      });
    });

    executor.on('error', (error: string) => {
      console.log(`[WebSocket] session.error for ${sessionId}: ${error}`);
      this.send(ws, {
        type: 'session.error',
        payload: { sessionId, error } as SessionErrorPayload
      });
    });

    executor.on('complete', (exitCode: number) => {
      console.log(`[WebSocket] session.complete for ${sessionId}: exitCode=${exitCode}`);
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
