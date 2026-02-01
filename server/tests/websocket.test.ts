import { WebSocketTransport, type AuthenticatedWebSocket, type WSMessage } from '../src/transport/index.js';
import { HttpTransport } from '../src/transport/index.js';
import WebSocket from 'ws';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';

// Test configuration for API key
const TEST_CONFIG_DIR = join(tmpdir(), `claude-ws-test-${Date.now()}`);
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

// Setup test config directory
mkdirSync(TEST_CONFIG_DIR, { recursive: true });
process.env.CLAUDE_HISTORY_CONFIG_DIR = TEST_CONFIG_DIR;

interface Config {
  apiKeyHash?: string;
  apiKeyCreatedAt?: string;
}

function createTestApiKey(): string {
  const key = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(key).digest('hex');
  const config: Config = {
    apiKeyHash: hash,
    apiKeyCreatedAt: new Date().toISOString()
  };
  writeFileSync(TEST_CONFIG_FILE, JSON.stringify(config));
  return key;
}

function removeTestApiKey(): void {
  if (existsSync(TEST_CONFIG_FILE)) {
    writeFileSync(TEST_CONFIG_FILE, JSON.stringify({}));
  }
}

describe('WebSocketTransport', () => {
  let httpTransport: HttpTransport;
  let wsTransport: WebSocketTransport;
  let testApiKey: string;
  let serverPort: number;

  beforeAll(async () => {
    testApiKey = createTestApiKey();

    // Start HTTP server on random port
    httpTransport = new HttpTransport({ port: 0 });
    await httpTransport.start();

    const server = httpTransport.getServer();
    const address = server!.address() as { port: number };
    serverPort = address.port;
  });

  afterAll(async () => {
    await wsTransport?.stop();
    await httpTransport?.stop();
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  describe('constructor and start', () => {
    it('should initialize with isRunning false', () => {
      const server = httpTransport.getServer()!;
      const transport = new WebSocketTransport({ server });
      expect(transport.isRunning).toBe(false);
    });

    it('should start and set isRunning to true', () => {
      const server = httpTransport.getServer()!;
      wsTransport = new WebSocketTransport({ server, path: '/ws' });
      wsTransport.start();
      expect(wsTransport.isRunning).toBe(true);
    });

    it('should throw if started twice', () => {
      expect(() => wsTransport.start()).toThrow('WebSocket transport is already running');
    });
  });

  describe('authentication', () => {
    it('should reject connection without API key', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);

      ws.on('error', () => {
        // Expected - connection rejected
        done();
      });

      ws.on('open', () => {
        ws.close();
        done(new Error('Should not connect without API key'));
      });

      // Timeout for connection attempt
      setTimeout(() => {
        ws.close();
        done();
      }, 1000);
    });

    it('should reject connection with invalid API key', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=invalid-key`);

      ws.on('error', () => {
        // Expected - connection rejected
        done();
      });

      ws.on('open', () => {
        ws.close();
        done(new Error('Should not connect with invalid API key'));
      });

      setTimeout(() => {
        ws.close();
        done();
      }, 1000);
    });

    it('should accept connection with valid API key', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (err) => {
        done(err);
      });
    });

    it('should send auth_result on successful connection', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;
        expect(message.type).toBe('auth_result');
        expect((message.payload as { success: boolean }).success).toBe(true);
        ws.close();
        done();
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('ping/pong', () => {
    it('should respond to ping with pong', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);
      let authReceived = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;

        if (message.type === 'auth_result') {
          authReceived = true;
          // Send ping
          ws.send(JSON.stringify({ type: 'ping', id: 'test-ping-1' }));
        } else if (message.type === 'pong') {
          expect(authReceived).toBe(true);
          expect(message.id).toBe('test-ping-1');
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('message handling', () => {
    it('should handle custom message types via ping/pong', (done) => {
      // Test using the existing wsTransport's ping/pong (which is already covered)
      // This test verifies the message parsing and response mechanism
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);
      let authReceived = false;

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;

        if (message.type === 'auth_result') {
          authReceived = true;
          // Send a custom ping with ID
          ws.send(JSON.stringify({ type: 'ping', id: 'custom-ping-123' }));
        } else if (message.type === 'pong' && authReceived) {
          // Verify the pong contains our custom ID
          expect(message.id).toBe('custom-ping-123');
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('client management', () => {
    it('should track connected clients', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;

        if (message.type === 'auth_result') {
          // Client is now fully registered - check that count is at least 1
          expect(wsTransport.getClientCount()).toBeGreaterThanOrEqual(1);

          // Save current count before closing
          const countBeforeClose = wsTransport.getClientCount();
          ws.close();

          // After close, count should decrease (with small delay for cleanup)
          setTimeout(() => {
            expect(wsTransport.getClientCount()).toBeLessThan(countBeforeClose);
            done();
          }, 100);
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('broadcast', () => {
    it('should broadcast message to all clients', (done) => {
      const ws1 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);
      const ws2 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);

      let client1Received = false;
      let client2Received = false;
      let client1Auth = false;
      let client2Auth = false;

      const checkDone = () => {
        if (client1Received && client2Received) {
          ws1.close();
          ws2.close();
          done();
        }
      };

      ws1.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;
        if (message.type === 'auth_result') {
          client1Auth = true;
          if (client1Auth && client2Auth) {
            // Both connected, broadcast
            wsTransport.broadcast({ type: 'message', payload: { broadcast: true } });
          }
        } else if (message.type === 'message') {
          expect((message.payload as { broadcast: boolean }).broadcast).toBe(true);
          client1Received = true;
          checkDone();
        }
      });

      ws2.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;
        if (message.type === 'auth_result') {
          client2Auth = true;
          if (client1Auth && client2Auth) {
            wsTransport.broadcast({ type: 'message', payload: { broadcast: true } });
          }
        } else if (message.type === 'message') {
          expect((message.payload as { broadcast: boolean }).broadcast).toBe(true);
          client2Received = true;
          checkDone();
        }
      });

      ws1.on('error', (err) => done(err));
      ws2.on('error', (err) => done(err));
    });
  });

  describe('no auth configured', () => {
    it('should allow connections when no API key is configured', (done) => {
      removeTestApiKey();

      // Create new transports without auth
      const noAuthHttp = new HttpTransport({ port: 0 });

      noAuthHttp.start().then(() => {
        const server = noAuthHttp.getServer()!;
        const address = server.address() as { port: number };

        const noAuthWs = new WebSocketTransport({ server, path: '/ws' });
        noAuthWs.start();

        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);

        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          noAuthWs.stop().then(() => noAuthHttp.stop()).then(() => {
            // Restore API key for other tests
            testApiKey = createTestApiKey();
            done();
          });
        });

        ws.on('error', (err) => {
          noAuthWs.stop().then(() => noAuthHttp.stop()).then(() => done(err));
        });
      });
    });
  });
});
