import { WebSocketGateway, HttpTransport } from './index';
import type { WSMessage } from './index';
import WebSocket from 'ws';
import { noopLogger } from '../../tests/__helpers/index';

const TEST_KEY = 'test-api-key-for-ws-gateway';

describe('WebSocketGateway', () => {
  let httpTransport: HttpTransport;
  let wsGateway: WebSocketGateway;
  let serverPort: number;

  beforeAll(async () => {
    httpTransport = new HttpTransport({ port: 0 });
    await httpTransport.start();

    const server = httpTransport.getServer();
    const address = server!.address() as { port: number };
    serverPort = address.port;
  });

  afterAll(async () => {
    await wsGateway?.stop();
    await httpTransport?.stop();
  });

  describe('constructor and start', () => {
    it('should initialize with isRunning false', () => {
      const server = httpTransport.getServer()!;
      const gateway = new WebSocketGateway({ server, logger: noopLogger });
      expect(gateway.isRunning).toBe(false);
    });

    it('should start and set isRunning to true', () => {
      const server = httpTransport.getServer()!;
      wsGateway = new WebSocketGateway({
        server,
        path: '/ws',
        logger: noopLogger,
        hasApiKey: () => true,
        validateApiKey: (key) => key === TEST_KEY,
      });
      wsGateway.start();
      expect(wsGateway.isRunning).toBe(true);
    });

    it('should throw if started twice', () => {
      expect(() => wsGateway.start()).toThrow('WebSocket gateway is already running');
    });
  });

  describe('authentication', () => {
    it('should reject connection without API key', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);

        ws.on('error', () => {
          resolve();
        });

        ws.on('open', () => {
          ws.close();
          reject(new Error('Should not connect without API key'));
        });

        setTimeout(() => {
          ws.close();
          resolve();
        }, 1000);
      });
    });

    it('should reject connection with invalid API key', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=invalid-key`);

        ws.on('error', () => {
          resolve();
        });

        ws.on('open', () => {
          ws.close();
          reject(new Error('Should not connect with invalid API key'));
        });

        setTimeout(() => {
          ws.close();
          resolve();
        }, 1000);
      });
    });

    it('should accept connection with valid API key', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);

        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve();
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });
    });

    it('should send auth_result on successful connection', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WSMessage;
          expect(message.type).toBe('auth_result');
          expect((message.payload as { success: boolean }).success).toBe(true);
          ws.close();
          resolve();
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });
    });
  });

  describe('ping/pong', () => {
    it('should respond to ping with pong', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);
        let authReceived = false;

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WSMessage;

          if (message.type === 'auth_result') {
            authReceived = true;
            ws.send(JSON.stringify({ type: 'ping', id: 'test-ping-1' }));
          } else if (message.type === 'pong') {
            expect(authReceived).toBe(true);
            expect(message.id).toBe('test-ping-1');
            ws.close();
            resolve();
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });
    });
  });

  describe('message handling', () => {
    it('should handle custom message types via ping/pong', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);
        let authReceived = false;

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WSMessage;

          if (message.type === 'auth_result') {
            authReceived = true;
            ws.send(JSON.stringify({ type: 'ping', id: 'custom-ping-123' }));
          } else if (message.type === 'pong' && authReceived) {
            expect(message.id).toBe('custom-ping-123');
            ws.close();
            resolve();
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });
    });
  });

  describe('client management', () => {
    it('should track connected clients', () => {
      return new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WSMessage;

          if (message.type === 'auth_result') {
            expect(wsGateway.getClientCount()).toBeGreaterThanOrEqual(1);

            const countBeforeClose = wsGateway.getClientCount();
            ws.close();

            setTimeout(() => {
              expect(wsGateway.getClientCount()).toBeLessThan(countBeforeClose);
              resolve();
            }, 100);
          }
        });

        ws.on('error', (err) => {
          reject(err);
        });
      });
    });
  });

  describe('broadcast', () => {
    it('should broadcast message to all clients', () => {
      return new Promise<void>((resolve, reject) => {
        const ws1 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);
        const ws2 = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${TEST_KEY}`);

        let client1Received = false;
        let client2Received = false;
        let client1Auth = false;
        let client2Auth = false;

        const checkDone = () => {
          if (client1Received && client2Received) {
            ws1.close();
            ws2.close();
            resolve();
          }
        };

        ws1.on('message', (data) => {
          const message = JSON.parse(data.toString()) as WSMessage;
          if (message.type === 'auth_result') {
            client1Auth = true;
            if (client1Auth && client2Auth) {
              wsGateway.broadcast({ type: 'message', payload: { broadcast: true } });
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
              wsGateway.broadcast({ type: 'message', payload: { broadcast: true } });
            }
          } else if (message.type === 'message') {
            expect((message.payload as { broadcast: boolean }).broadcast).toBe(true);
            client2Received = true;
            checkDone();
          }
        });

        ws1.on('error', (err) => reject(err));
        ws2.on('error', (err) => reject(err));
      });
    });
  });

  describe('no auth configured', () => {
    it('should allow connections when no API key is configured', async () => {
      const noAuthHttp = new HttpTransport({ port: 0 });
      let noAuthWs: WebSocketGateway | undefined;

      try {
        await noAuthHttp.start();

        const server = noAuthHttp.getServer()!;
        const address = server.address() as { port: number };

        noAuthWs = new WebSocketGateway({
          server,
          path: '/ws',
          logger: noopLogger,
          hasApiKey: () => false,
          validateApiKey: () => false,
        });
        noAuthWs.start();

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);

          ws.on('open', () => {
            expect(ws.readyState).toBe(WebSocket.OPEN);
            ws.close();
            resolve();
          });

          ws.on('error', (err) => {
            reject(err);
          });
        });
      } finally {
        await noAuthWs?.stop();
        await noAuthHttp.stop();
      }
    });
  });
});
