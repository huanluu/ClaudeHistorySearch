import { HttpTransport } from '../src/transport/index.js';
import http from 'http';
import { Router, type Request, type Response, type NextFunction } from 'express';

describe('HttpTransport', () => {
  let transport: HttpTransport;

  afterEach(async () => {
    // Clean up: stop transport if running
    if (transport && transport.isRunning) {
      await transport.stop();
    }
  });

  describe('constructor', () => {
    it('should use default port 3847 when not specified', () => {
      transport = new HttpTransport();
      expect(transport.port).toBe(3847);
    });

    it('should use custom port when specified', () => {
      transport = new HttpTransport({ port: 4000 });
      expect(transport.port).toBe(4000);
    });

    it('should use default host 0.0.0.0 when not specified', () => {
      transport = new HttpTransport();
      expect(transport.host).toBe('0.0.0.0');
    });

    it('should use custom host when specified', () => {
      transport = new HttpTransport({ host: '127.0.0.1' });
      expect(transport.host).toBe('127.0.0.1');
    });

    it('should initialize isRunning as false', () => {
      transport = new HttpTransport();
      expect(transport.isRunning).toBe(false);
    });
  });

  describe('getApp', () => {
    it('should return the Express app instance', () => {
      transport = new HttpTransport();
      const app = transport.getApp();
      expect(app).toBeDefined();
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });
  });

  describe('getServer', () => {
    it('should return null before start', () => {
      transport = new HttpTransport();
      expect(transport.getServer()).toBeNull();
    });

    it('should return HTTP server instance after start', async () => {
      transport = new HttpTransport({ port: 0 }); // Port 0 = random available port
      await transport.start();

      const server = transport.getServer();
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(http.Server);
    });
  });

  describe('start', () => {
    it('should start the server and set isRunning to true', async () => {
      transport = new HttpTransport({ port: 0 });

      expect(transport.isRunning).toBe(false);
      await transport.start();
      expect(transport.isRunning).toBe(true);
    });

    it('should throw error if already running', async () => {
      transport = new HttpTransport({ port: 0 });
      await transport.start();

      await expect(transport.start()).rejects.toThrow('Transport is already running');
    });

    it('should bind to the specified port', async () => {
      transport = new HttpTransport({ port: 0 });
      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      expect(address).toBeDefined();
      expect(typeof address.port).toBe('number');
      expect(address.port).toBeGreaterThan(0);
    });

    it('should bind to all interfaces (0.0.0.0 or ::) by default', async () => {
      // This test catches the "network connection lost" bug where server
      // only bound to localhost, making it unreachable from other devices
      transport = new HttpTransport({ port: 0 });
      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { address: string; port: number; family: string };

      expect(address).toBeDefined();
      // Server should bind to all interfaces, not localhost/127.0.0.1
      // '::' is IPv6 all interfaces, '0.0.0.0' is IPv4 all interfaces
      expect(['0.0.0.0', '::']).toContain(address.address);
    });

    it('should be reachable via 127.0.0.1 when bound to all interfaces', async () => {
      transport = new HttpTransport({ port: 0 });

      transport.getApp().get('/ping', (_req, res) => {
        res.json({ pong: true });
      });

      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };

      // Verify we can actually connect via loopback
      const response = await fetch(`http://127.0.0.1:${address.port}/ping`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.pong).toBe(true);
    });
  });

  describe('stop', () => {
    it('should stop the server and set isRunning to false', async () => {
      transport = new HttpTransport({ port: 0 });
      await transport.start();
      expect(transport.isRunning).toBe(true);

      await transport.stop();
      expect(transport.isRunning).toBe(false);
    });

    it('should set server to null after stop', async () => {
      transport = new HttpTransport({ port: 0 });
      await transport.start();
      expect(transport.getServer()).not.toBeNull();

      await transport.stop();
      expect(transport.getServer()).toBeNull();
    });

    it('should do nothing if not running', async () => {
      transport = new HttpTransport({ port: 0 });
      // Should not throw
      await transport.stop();
      expect(transport.isRunning).toBe(false);
    });
  });

  describe('use (middleware)', () => {
    it('should register middleware on the Express app', async () => {
      transport = new HttpTransport({ port: 0 });

      let middlewareCalled = false;
      transport.use((_req: Request, _res: Response, next: NextFunction) => {
        middlewareCalled = true;
        next();
      });

      // Add a test route
      transport.getApp().get('/test', (_req: Request, res: Response) => {
        res.json({ ok: true });
      });

      await transport.start();

      // Make a request to trigger middleware
      const server = transport.getServer();
      const address = server!.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/test`);

      expect(middlewareCalled).toBe(true);
      expect(response.ok).toBe(true);
    });

    it('should register router with path prefix', async () => {
      transport = new HttpTransport({ port: 0 });

      // Create a mini router
      const router = Router();
      router.get('/hello', (_req: Request, res: Response) => {
        res.json({ message: 'world' });
      });

      transport.use('/api', router);
      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/hello`);
      const data = await response.json();

      expect(data.message).toBe('world');
    });
  });

  describe('default middleware', () => {
    it('should parse JSON request bodies', async () => {
      transport = new HttpTransport({ port: 0 });

      let receivedBody: unknown = null;
      transport.getApp().post('/echo', (req: Request, res: Response) => {
        receivedBody = req.body;
        res.json(req.body);
      });

      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      await fetch(`http://127.0.0.1:${address.port}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      });

      expect(receivedBody).toEqual({ test: 'data' });
    });

    it('should add CORS headers', async () => {
      transport = new HttpTransport({ port: 0 });

      transport.getApp().get('/cors-test', (_req: Request, res: Response) => {
        res.json({ ok: true });
      });

      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/cors-test`);

      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should handle OPTIONS preflight requests', async () => {
      transport = new HttpTransport({ port: 0 });
      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/any-path`, {
        method: 'OPTIONS'
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('middleware order', () => {
    it('should execute middleware in registration order', async () => {
      transport = new HttpTransport({ port: 0 });

      const executionOrder: string[] = [];

      transport.use((_req: Request, _res: Response, next: NextFunction) => {
        executionOrder.push('first');
        next();
      });

      transport.use((_req: Request, _res: Response, next: NextFunction) => {
        executionOrder.push('second');
        next();
      });

      transport.getApp().get('/order-test', (_req: Request, res: Response) => {
        executionOrder.push('handler');
        res.json({ order: executionOrder });
      });

      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      await fetch(`http://127.0.0.1:${address.port}/order-test`);

      expect(executionOrder).toEqual(['first', 'second', 'handler']);
    });

    it('should allow middleware to short-circuit the chain', async () => {
      transport = new HttpTransport({ port: 0 });

      const executionOrder: string[] = [];

      transport.use((_req: Request, _res: Response, next: NextFunction) => {
        executionOrder.push('first');
        next();
      });

      transport.use((_req: Request, res: Response, _next: NextFunction) => {
        executionOrder.push('blocker');
        res.status(403).json({ error: 'Blocked' }); // Don't call next()
      });

      transport.use((_req: Request, _res: Response, next: NextFunction) => {
        executionOrder.push('never-reached');
        next();
      });

      transport.getApp().get('/blocked', (_req: Request, res: Response) => {
        executionOrder.push('handler');
        res.json({ ok: true });
      });

      await transport.start();

      const server = transport.getServer();
      const address = server!.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/blocked`);

      expect(response.status).toBe(403);
      expect(executionOrder).toEqual(['first', 'blocker']);
      expect(executionOrder).not.toContain('never-reached');
      expect(executionOrder).not.toContain('handler');
    });
  });
});
