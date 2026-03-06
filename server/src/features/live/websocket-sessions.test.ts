import { EventEmitter } from 'events';
import { mkdirSync, rmSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';
import { WorkingDirValidator } from '../../shared/provider/index';
import { HttpTransport, WebSocketGateway } from '../../gateway/index';
import { AgentStore, registerLiveHandlers } from './index';
import { ClaudeAgentSession } from '../../shared/infra/runtime/index';
import { noopLogger, createTestApiKey } from '../../../tests/__helpers/index';

// Hoist the mock so it's available when vi.mock factory runs
const mockSpawn = vi.hoisted(() => vi.fn());

// Mock child_process for session execution
vi.mock('child_process', () => ({
  spawn: mockSpawn
}));

// Test configuration
const TEST_CONFIG_DIR = join(tmpdir(), `claude-ws-session-test-${Date.now()}`);
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.json');

function createMockProcess() {
  const mockProcess = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    pid: Math.floor(Math.random() * 10000)
  });
  return mockProcess;
}

interface WSMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

/** Wait for a WebSocket message matching the given type. */
function waitForMessage(ws: WebSocket, type: string, timeout = 2000): Promise<WSMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for '${type}' message`)), timeout);
    function handler(data: WebSocket.RawData) {
      const msg = JSON.parse(data.toString()) as WSMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

/** Poll a predicate until it passes or times out. */
function waitFor(fn: () => void, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function check() {
      try {
        fn();
        resolve();
      } catch {
        if (Date.now() >= deadline) {
          reject(new Error(`waitFor timed out after ${timeout}ms`));
        } else {
          setTimeout(check, 10);
        }
      }
    }
    check();
  });
}

describe('WebSocket Session Integration', () => {
  let httpTransport: InstanceType<typeof HttpTransport>;
  let wsGateway: WebSocketGateway;
  let testApiKey: string;
  let serverPort: number;

  beforeAll(async () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    process.env.CLAUDE_HISTORY_CONFIG_DIR = TEST_CONFIG_DIR;
    testApiKey = createTestApiKey(TEST_CONFIG_FILE);

    // Start HTTP server
    httpTransport = new HttpTransport({ port: 0 });
    await httpTransport.start();

    const server = httpTransport.getServer()!;
    const address = server.address() as { port: number };
    serverPort = address.port;

    // Start WebSocket gateway with handler registration
    const resolvedConfigDir = realpathSync(TEST_CONFIG_DIR);
    const resolvedTmp = realpathSync('/tmp');
    const validator = new WorkingDirValidator([resolvedConfigDir, resolvedTmp]);
    const agentStore = new AgentStore(noopLogger, (id, _source, log) => new ClaudeAgentSession(id, log));
    wsGateway = new WebSocketGateway({ server, path: '/ws', logger: noopLogger });
    registerLiveHandlers(wsGateway, { agentStore, validator, logger: noopLogger });
    wsGateway.start();
  });

  afterAll(async () => {
    await wsGateway?.stop();
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

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-1',
          prompt: 'List files',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      const msgPromise = waitForMessage(ws, 'session.output');
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","content":"Here are the files:"}\n'));
      const outputMsg = await msgPromise;

      expect((outputMsg.payload as { sessionId: string }).sessionId).toBe('test-session-1');

      ws.close();
    });

    it('sends session.complete when process exits', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-2',
          prompt: 'test',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      const msgPromise = waitForMessage(ws, 'session.complete');
      mockProcess.emit('exit', 0);
      const completeMsg = await msgPromise;

      expect((completeMsg.payload as { sessionId: string }).sessionId).toBe('test-session-2');
      expect((completeMsg.payload as { exitCode: number }).exitCode).toBe(0);

      ws.close();
    });

    it('sends session.error when process outputs to stderr', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-3',
          prompt: 'test',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      const msgPromise = waitForMessage(ws, 'session.error');
      mockProcess.stderr.emit('data', Buffer.from('Error: Something went wrong\n'));
      const errorMsg = await msgPromise;

      expect((errorMsg.payload as { sessionId: string }).sessionId).toBe('test-session-3');
      expect((errorMsg.payload as { error: string }).error).toContain('Something went wrong');

      ws.close();
    });
  });

  describe('session.cancel message', () => {
    it('cancels running session', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-session-cancel',
          prompt: 'long running task',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      ws.send(JSON.stringify({
        type: 'session.cancel',
        payload: {
          sessionId: 'test-session-cancel'
        }
      }));

      await waitFor(() => expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM'));

      ws.close();
    });
  });

  describe('session.resume message', () => {
    it('handles session.resume with resumeSessionId', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.resume',
        payload: {
          sessionId: 'new-interaction-id',
          resumeSessionId: '0924732e-36d8-4c79-9408-2fac17974c28',
          prompt: 'continue from here',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--resume', '0924732e-36d8-4c79-9408-2fac17974c28'
        ]),
        expect.any(Object)
      ));

      ws.close();
    });
  });

  describe('client disconnect cleanup', () => {
    it('cancels all sessions when client disconnects', async () => {
      const mockProcess1 = createMockProcess();
      const mockProcess2 = createMockProcess();
      mockSpawn.mockReturnValueOnce(mockProcess1).mockReturnValueOnce(mockProcess2);

      const ws = await connectClient();

      // Start first session
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: { sessionId: 'session-a', prompt: 'task 1', workingDir: '/tmp' }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));

      // Start second session
      ws.send(JSON.stringify({
        type: 'session.start',
        payload: { sessionId: 'session-b', prompt: 'task 2', workingDir: '/tmp' }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));

      // Disconnect client
      ws.close();

      // Both processes should be killed
      await waitFor(() => {
        expect(mockProcess1.kill).toHaveBeenCalledWith('SIGTERM');
        expect(mockProcess2.kill).toHaveBeenCalledWith('SIGTERM');
      });
    });
  });

  describe('Working directory validation', () => {
    it('rejects session.start with disallowed directory', async () => {
      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-forbidden-dir',
          prompt: 'hack the planet',
          workingDir: '/etc'
        }
      }));

      const errorMsg = await waitForMessage(ws, 'session.error');
      expect((errorMsg.payload as { error: string }).error).toMatch(/not within any allowed directory/i);
      expect(mockSpawn).not.toHaveBeenCalled();

      ws.close();
    });

    it('rejects path traversal attempt', async () => {
      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-traversal',
          prompt: 'traversal',
          workingDir: '/tmp/../../etc'
        }
      }));

      const errorMsg = await waitForMessage(ws, 'session.error');
      expect(errorMsg).toBeDefined();
      expect(mockSpawn).not.toHaveBeenCalled();

      ws.close();
    });

    it('rejects session.resume with disallowed directory', async () => {
      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.resume',
        payload: {
          sessionId: 'test-resume-forbidden',
          resumeSessionId: 'some-session-id',
          prompt: 'continue',
          workingDir: '/etc'
        }
      }));

      const errorMsg = await waitForMessage(ws, 'session.error');
      expect(errorMsg).toBeDefined();
      expect(mockSpawn).not.toHaveBeenCalled();

      ws.close();
    });

    it('allows session.start with allowed directory', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const ws = await connectClient();

      ws.send(JSON.stringify({
        type: 'session.start',
        payload: {
          sessionId: 'test-allowed-dir',
          prompt: 'hello',
          workingDir: '/tmp'
        }
      }));

      await waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      ws.close();
    });
  });
});
