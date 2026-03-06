import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server, IncomingMessage } from 'http';
import { URL } from 'url';
import { ZodError } from 'zod';
import { validateApiKey, hasApiKey } from '../shared/provider/index';
import type { Logger } from '../shared/provider/index';
import type { AuthenticatedClient, MessageType, WSMessage } from './protocol';
import type { WsHandler, WsConnectionHandler, WsGateway } from './types';
import { payloadSchemas } from './schemas';

/**
 * Extended WebSocket with authentication state (internal to gateway)
 */
interface InternalClient extends WebSocket {
  isAuthenticated: boolean;
  clientId: string;
}

export interface WebSocketGatewayOptions {
  server: Server;
  path?: string;
  pingInterval?: number;
  logger: Logger;
}

/**
 * WebSocketGateway — manages WebSocket connections, authentication, and message routing.
 *
 * Features register handlers for specific message types. The gateway:
 * 1. Accepts connections and authenticates via API key query parameter
 * 2. Parses incoming messages and routes to registered handlers
 * 3. Manages ping/pong keepalive
 * 4. Provides AuthenticatedClient abstraction so features never touch raw WebSocket
 */
export class WebSocketGateway implements WsGateway {
  private wss: WebSocketServer | null = null;
  private server: Server;
  private path: string;
  private pingInterval: number;
  private pingTimer: NodeJS.Timeout | null = null;
  private clients: Set<InternalClient> = new Set();
  private clientMap: Map<string, InternalClient> = new Map();
  private logger: Logger;

  private handlers: Map<string, WsHandler<unknown>> = new Map();
  private connectHandlers: WsConnectionHandler[] = [];
  private disconnectHandlers: WsConnectionHandler[] = [];

  public isRunning = false;

  constructor(options: WebSocketGatewayOptions) {
    this.server = options.server;
    this.path = options.path ?? '/ws';
    this.pingInterval = options.pingInterval ?? 30000;
    this.logger = options.logger;
  }

  on<T = unknown>(type: string, handler: WsHandler<T>): void {
    // Safe: gateway validates payload matches schema before calling handler
    this.handlers.set(type, handler as WsHandler<unknown>);
  }

  onConnect(handler: WsConnectionHandler): void {
    this.connectHandlers.push(handler);
  }

  onDisconnect(handler: WsConnectionHandler): void {
    this.disconnectHandlers.push(handler);
  }

  start(): void {
    if (this.isRunning) {
      throw new Error('WebSocket gateway is already running');
    }

    this.wss = new WebSocketServer({
      server: this.server,
      path: this.path,
      verifyClient: this._verifyClient.bind(this),
    });

    this.wss.on('connection', this._handleConnection.bind(this));
    this.wss.on('error', (error) => {
      this.logger.error({ msg: `Server error: ${(error as Error).message}`, op: 'ws.error', err: error });
    });

    this._startPingInterval();
    this.isRunning = true;
    this.logger.log({ msg: `Server started on path ${this.path}`, op: 'ws.connect', context: { path: this.path } });
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.wss) {
      return;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const client of this.clients) {
      client.close(1000, 'Server shutting down');
    }
    this.clients.clear();
    this.clientMap.clear();

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

  broadcast(message: WSMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.isAuthenticated && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getClients(): Set<InternalClient> {
    return this.clients;
  }

  private _createAuthenticatedClient(ws: InternalClient): AuthenticatedClient {
    return {
      clientId: ws.clientId,
      send: (message: WSMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
    };
  }

  private _verifyClient(
    info: { origin: string; secure: boolean; req: IncomingMessage },
    callback: (result: boolean, code?: number, message?: string) => void,
  ): void {
    if (!hasApiKey()) {
      callback(true);
      return;
    }

    const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
    const apiKey = url.searchParams.get('apiKey');

    if (!apiKey) {
      this.logger.log({ msg: 'WebSocket rejected: no API key in query', op: 'ws.upgrade' });
      callback(false, 401, 'API key required');
      return;
    }

    if (!validateApiKey(apiKey)) {
      this.logger.log({ msg: 'WebSocket rejected: invalid API key', op: 'ws.upgrade' });
      callback(false, 401, 'Invalid API key');
      return;
    }

    callback(true);
  }

  private _handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const internalWs = ws as InternalClient;
    internalWs.isAuthenticated = true;
    internalWs.clientId = this._generateClientId();

    this.clients.add(internalWs);
    this.clientMap.set(internalWs.clientId, internalWs);
    this.logger.log({ msg: `Client connected: ${internalWs.clientId}`, op: 'ws.connect', context: { clientId: internalWs.clientId } });

    const client = this._createAuthenticatedClient(internalWs);

    // Send auth success — BEFORE calling onConnect handlers
    client.send({
      type: 'auth_result',
      payload: { success: true } as { success: boolean },
    });

    // Notify connect handlers
    for (const handler of this.connectHandlers) {
      handler(client);
    }

    ws.on('message', (data) => {
      this._handleMessage(client, data);
    });

    ws.on('close', () => {
      this.clients.delete(internalWs);
      this.clientMap.delete(internalWs.clientId);
      this.logger.log({ msg: `Client disconnected: ${internalWs.clientId}`, op: 'ws.disconnect', context: { clientId: internalWs.clientId } });

      // Notify disconnect handlers — features do cleanup here
      for (const handler of this.disconnectHandlers) {
        handler(client);
      }
    });

    ws.on('error', (error) => {
      this.logger.error({ msg: `Client error (${internalWs.clientId}): ${(error as Error).message}`, op: 'ws.error', err: error, context: { clientId: internalWs.clientId } });
    });

    ws.on('pong', () => {
      // Client is alive
    });
  }

  private _handleMessage(client: AuthenticatedClient, data: RawData): void {
    try {
      const raw = JSON.parse(data.toString());

      // Basic envelope validation: must have a string `type`
      if (!raw || typeof raw.type !== 'string') {
        client.send({
          type: 'error',
          payload: { message: 'Invalid message: missing or non-string "type" field' },
        });
        return;
      }

      const messageType = raw.type as MessageType;

      // Handle ping/pong at gateway level (no payload to validate)
      if (messageType === 'ping') {
        client.send({ type: 'pong', id: raw.id });
        return;
      }

      // Route to registered handler
      const handler = this.handlers.get(messageType);
      if (!handler) {
        this.logger.log({ msg: `Unhandled message type: ${messageType}`, op: 'ws.message', context: { type: messageType, clientId: client.clientId } });
        return;
      }

      // Validate payload against schema if one exists
      const schema = payloadSchemas[messageType];
      let validatedPayload = raw.payload;
      if (schema) {
        validatedPayload = schema.parse(raw.payload);
      }

      handler(client, validatedPayload, raw.id);
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ).join('; ');
        this.logger.log({ msg: `Payload validation failed: ${details}`, op: 'ws.validation', context: { clientId: client.clientId } });
        client.send({
          type: 'error',
          payload: { message: `Validation error: ${details}` },
        });
        return;
      }
      this.logger.error({ msg: `Failed to parse message: ${(error as Error).message}`, op: 'ws.error', err: error });
      client.send({
        type: 'error',
        payload: { message: 'Invalid message format' },
      });
    }
  }

  private _startPingInterval(): void {
    this.pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, this.pingInterval);
  }

  private _generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
