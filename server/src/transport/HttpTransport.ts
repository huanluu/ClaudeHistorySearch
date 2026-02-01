import express, { type Application, type RequestHandler, type Router } from 'express';
import type { Server } from 'http';
import { Transport, type TransportOptions } from './Transport.js';

/**
 * Options for configuring HttpTransport
 */
export interface HttpTransportOptions extends TransportOptions {
  host?: string;
}

/**
 * HttpTransport - Express-based HTTP transport implementation
 *
 * Wraps Express server and exposes it through the Transport interface.
 * Handles CORS, JSON parsing, and provides access to the underlying
 * HTTP server for WebSocket upgrade.
 */
export class HttpTransport extends Transport {
  private host: string;
  private app: Application;
  private server: Server | null;

  constructor(options: HttpTransportOptions = {}) {
    super(options);
    this.host = options.host ?? '0.0.0.0';
    this.app = express();
    this.server = null;

    this._setupDefaults();
  }

  /**
   * Setup default middleware (JSON parsing, CORS)
   */
  private _setupDefaults(): void {
    this.app.use(express.json());

    // CORS middleware for local development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  /**
   * Register middleware or router
   */
  use(path: string, handler: RequestHandler | Router): void;
  use(handler: RequestHandler | Router): void;
  use(...args: unknown[]): void {
    // TypeScript requires explicit handling of overloads
    if (args.length === 1) {
      this.app.use(args[0] as RequestHandler | Router);
    } else if (args.length === 2) {
      this.app.use(args[0] as string, args[1] as RequestHandler | Router);
    }
  }

  /**
   * Get the Express app instance (for advanced configuration)
   */
  getApp(): Application {
    return this.app;
  }

  /**
   * Get the underlying HTTP server instance
   */
  getServer(): Server | null {
    return this.server;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Transport is already running');
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          this.isRunning = true;
          resolve();
        });

        this.server.on('error', (err: Error) => {
          this.isRunning = false;
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err?: Error) => {
        this.isRunning = false;
        this.server = null;
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export default HttpTransport;
