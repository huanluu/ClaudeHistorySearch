import express from 'express';
import { Transport } from './Transport.js';

/**
 * HttpTransport - Express-based HTTP transport implementation
 *
 * Wraps Express server and exposes it through the Transport interface.
 * Handles CORS, JSON parsing, and provides access to the underlying
 * HTTP server for WebSocket upgrade.
 */
export class HttpTransport extends Transport {
  /**
   * @param {Object} options
   * @param {number} options.port - Port to listen on
   * @param {string} options.host - Host to bind to (default: '0.0.0.0')
   */
  constructor(options = {}) {
    super(options);
    this.host = options.host || '0.0.0.0';
    this.app = express();
    this.server = null;

    this._setupDefaults();
  }

  /**
   * Setup default middleware (JSON parsing, CORS)
   */
  _setupDefaults() {
    this.app.use(express.json());

    // CORS middleware for local development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  /**
   * Register middleware
   * @param {Function|Object} middleware - Express middleware or router
   */
  use(...args) {
    this.app.use(...args);
  }

  /**
   * Get the Express app instance (for advanced configuration)
   * @returns {express.Application}
   */
  getApp() {
    return this.app;
  }

  /**
   * Get the underlying HTTP server instance
   * @returns {http.Server|null}
   */
  getServer() {
    return this.server;
  }

  /**
   * Start the HTTP server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Transport is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, this.host, () => {
          this.isRunning = true;
          resolve();
        });

        this.server.on('error', (err) => {
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
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((err) => {
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
