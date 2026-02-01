/**
 * Transport - Abstract base class for server transports
 *
 * Transports handle the communication layer (HTTP, WebSocket, etc.)
 * while delegating request handling to the application layer.
 */
export class Transport {
  /**
   * @param {Object} options
   * @param {number} options.port - Port to listen on
   * @param {Function} options.onRequest - Request handler callback
   */
  constructor(options = {}) {
    if (new.target === Transport) {
      throw new Error('Transport is an abstract class and cannot be instantiated directly');
    }

    this.port = options.port || 3847;
    this.onRequest = options.onRequest || (() => {});
    this.isRunning = false;
  }

  /**
   * Start the transport server
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error('start() must be implemented by subclass');
  }

  /**
   * Stop the transport server
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('stop() must be implemented by subclass');
  }

  /**
   * Get the underlying server instance (for attaching WebSocket, etc.)
   * @returns {Object|null}
   */
  getServer() {
    return null;
  }

  /**
   * Register middleware (transport-specific)
   * @param {Function} middleware
   */
  use(middleware) {
    throw new Error('use() must be implemented by subclass');
  }
}

/**
 * Request context passed to handlers
 * @typedef {Object} RequestContext
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {string} path - Request path
 * @property {Object} params - Route parameters
 * @property {Object} query - Query string parameters
 * @property {Object} body - Request body (for POST/PUT)
 * @property {Object} headers - Request headers
 * @property {Function} send - Send response: send(statusCode, data)
 * @property {Function} json - Send JSON response: json(data)
 * @property {Function} error - Send error response: error(statusCode, message)
 */

export default Transport;
