import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import WebSocket from 'ws';

// Create mock spawn function
const mockSpawn = jest.fn();

// Mock child_process for session execution
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn
}));

// Test configuration
const TEST_CONFIG_DIR = join(tmpdir(), `claude-ws-session-test-${Date.now()}`);
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

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

function createMockProcess() {
  const mockProcess = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: jest.fn(), end: jest.fn() },
    kill: jest.fn(),
    pid: Math.floor(Math.random() * 10000)
  });
  return mockProcess;
}

interface WSMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

describe('WebSocket Session Integration', () => {
  let httpTransport: Awaited<ReturnType<typeof import('../src/transport/index.js')>>['HttpTransport'] extends new (...args: unknown[]) => infer R ? R : never;
  let wsTransport: Awaited<ReturnType<typeof import('../src/transport/index.js')>>['WebSocketTransport'] extends new (...args: unknown[]) => infer R ? R : never;
  let testApiKey: string;
  let serverPort: number;
  let HttpTransport: Awaited<ReturnType<typeof import('../src/transport/index.js')>>['HttpTransport'];
  let WebSocketTransport: Awaited<ReturnType<typeof import('../src/transport/index.js')>>['WebSocketTransport'];

  beforeAll(async () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    process.env.CLAUDE_HISTORY_CONFIG_DIR = TEST_CONFIG_DIR;
    testApiKey = createTestApiKey();

    // Import after mock setup
    const transportModule = await import('../src/transport/index.js');
    HttpTransport = transportModule.HttpTransport;
    WebSocketTransport = transportModule.WebSocketTransport;

    // Start HTTP server
    httpTransport = new HttpTransport({ port: 0 });
    await httpTransport.start();

    const server = httpTransport.getServer()!;
    const address = server.address() as { port: number };
    serverPort = address.port;

    // Start WebSocket server
    wsTransport = new WebSocketTransport({ server, path: '/ws' });
    wsTransport.start();
  });

  afterAll(async () => {
    await wsTransport?.stop();
    await httpTransport?.stop();
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockSpawn.mockReset();
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws?apiKey=${testApiKey}`);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString()) as WSMessage;
        if (message.type === 'auth_result') {
          resolve(ws);
        }
      });

      ws.on('error', reject);
    });
  }

  describe('session.start message', () => {
    it('handles session.start and streams output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();
      const messages: WSMessage[] = [];

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as WSMessage;
        if (msg.type !== 'auth_result') {
          messages.push(msg);
        }
      });

      // Send session.start
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-1',
          prompt: 'List files',
          workingDir: '/tmp'
        }
      }));

      // Wait for spawn to be called
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate output from claude
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","content":"Here are the files:"}\n'));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check we received output
      const outputMsg = messages.find(m => m.type === 'session.output');
      expect(outputMsg).toBeDefined();
      expect((outputMsg?.payload as { sessionId: string }).sessionId).toBe('test-session-1');

      ws.close();
    });

    it('sends session.complete when process exits', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();
      const messages: WSMessage[] = [];

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as WSMessage;
        if (msg.type !== 'auth_result') {
          messages.push(msg);
        }
      });

      // Send session.start
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-2',
          prompt: 'test',
          workingDir: '/tmp'
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate process exit
      mockProcess.emit('exit', 0);

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check we received complete message
      const completeMsg = messages.find(m => m.type === 'session.complete');
      expect(completeMsg).toBeDefined();
      expect((completeMsg?.payload as { sessionId: string }).sessionId).toBe('test-session-2');
      expect((completeMsg?.payload as { exitCode: number }).exitCode).toBe(0);

      ws.close();
    });

    it('sends session.error when process outputs to stderr', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();
      const messages: WSMessage[] = [];

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as WSMessage;
        if (msg.type !== 'auth_result') {
          messages.push(msg);
        }
      });

      // Send session.start
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-3',
          prompt: 'test',
          workingDir: '/tmp'
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Simulate stderr
      mockProcess.stderr.emit('data', Buffer.from('Error: Something went wrong\n'));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Check we received error message
      const errorMsg = messages.find(m => m.type === 'session.error');
      expect(errorMsg).toBeDefined();
      expect((errorMsg?.payload as { sessionId: string }).sessionId).toBe('test-session-3');
      expect((errorMsg?.payload as { error: string }).error).toContain('Something went wrong');

      ws.close();
    });
  });

  describe('session.cancel message', () => {
    it('cancels running session', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      // Start session
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-cancel',
          prompt: 'long running task',
          workingDir: '/tmp'
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Send cancel
      ws.send(JSON.stringify({
        type: 'session.cancel',
        payload: {
          sessionId: 'test-session-cancel'
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify kill was called
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      ws.close();
    });
  });

  describe('session.resume message', () => {
    it('handles session.resume with resumeSessionId', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      // Send session.resume
      ws.send(JSON.stringify({
        type: 'session.resume',
        payload: {
          sessionId: 'new-interaction-id',
          resumeSessionId: '0924732e-36d8-4c79-9408-2fac17974c28',
          prompt: 'continue from here',
          workingDir: '/tmp'
        }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify spawn was called with --resume flag
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--resume', '0924732e-36d8-4c79-9408-2fac17974c28'
        ]),
        expect.any(Object)
      );

      ws.close();
    });
  });

  describe('client disconnect cleanup', () => {
    it('cancels all sessions when client disconnects', async () => {
      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      const ws = await connectClient();

      // Start two sessions
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: { sessionId: 'session-a', prompt: 'task 1', workingDir: '/tmp' }
      }));

      await new Promise(resolve => setTimeout(resolve, 50));

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: { sessionId: 'session-b', prompt: 'task 2', workingDir: '/tmp' }
      }));

      await new Promise(resolve => setTimeout(resolve, 100));

      // Disconnect client
      ws.close();

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));

      // Both processes should be killed
      expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockProcess2.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
