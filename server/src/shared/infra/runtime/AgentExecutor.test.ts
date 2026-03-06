import { EventEmitter } from 'events';
import type { Mock } from 'vitest';
import type { Logger } from '../../provider/index';
import { AgentExecutor } from './index';
import { AgentStore } from '../../../features/live/index';

const noopLogger: Logger = {
  log: () => {},
  error: () => {},
  warn: () => {},
  verbose: () => {},
};

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

describe('AgentExecutor', () => {
  let mockProcess: {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: Mock; end: Mock };
    kill: Mock;
    pid: number;
  } & EventEmitter;

  beforeEach(() => {
    mockSpawn.mockReset();

    // Create mock child process
    mockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      kill: vi.fn(),
      pid: 12345
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  describe('start()', () => {
    it('spawns claude with correct arguments for new session', () => {
      const executor = new AgentExecutor('test-session-1', noopLogger);
      executor.start({
        prompt: 'List files in current directory',
        workingDir: '/tmp/test-project'
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '-p', 'List files in current directory',
          '--output-format', 'stream-json'
        ]),
        expect.objectContaining({
          cwd: '/tmp/test-project'
        })
      );
    });

    it('spawns claude with --resume flag when resumeSessionId provided', () => {
      const executor = new AgentExecutor('new-session-1', noopLogger);
      executor.start({
        prompt: 'continue from here',
        workingDir: '/tmp/test-project',
        resumeSessionId: '0924732e-36d8-4c79-9408-2fac17974c28'
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--resume', '0924732e-36d8-4c79-9408-2fac17974c28',
          '-p', 'continue from here',
          '--output-format', 'stream-json'
        ]),
        expect.any(Object)
      );
    });

    it('emits message events for JSON output lines', () => {
      const executor = new AgentExecutor('test-session-2', noopLogger);
      const messages: unknown[] = [];

      executor.on('message', (msg) => messages.push(msg));
      executor.start({ prompt: 'test', workingDir: '/tmp' });

      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":"Hello"}\n'));
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":"World"}\n'));

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ type: 'assistant', message: 'Hello' });
      expect(messages[1]).toEqual({ type: 'assistant', message: 'World' });
    });

    it('emits error events for stderr output', () => {
      const executor = new AgentExecutor('test-session-3', noopLogger);
      const errors: string[] = [];

      executor.on('error', (err) => errors.push(err));
      executor.start({ prompt: 'test', workingDir: '/tmp' });

      mockProcess.stderr.emit('data', Buffer.from('Error: Something went wrong\n'));

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Error: Something went wrong');
    });

    it('emits complete event with exit code', async () => {
      const executor = new AgentExecutor('test-session-4', noopLogger);

      const completePromise = new Promise<number>((resolve) => {
        executor.on('complete', (exitCode) => resolve(exitCode));
      });

      executor.start({ prompt: 'test', workingDir: '/tmp' });
      mockProcess.emit('exit', 0);

      const exitCode = await completePromise;
      expect(exitCode).toBe(0);
    });

    it('emits complete event with non-zero exit code on error', async () => {
      const executor = new AgentExecutor('test-session-5', noopLogger);

      const completePromise = new Promise<number>((resolve) => {
        executor.on('complete', (exitCode) => resolve(exitCode));
      });

      executor.start({ prompt: 'test', workingDir: '/tmp' });
      mockProcess.emit('exit', 1);

      const exitCode = await completePromise;
      expect(exitCode).toBe(1);
    });
  });

  describe('cancel()', () => {
    it('sends SIGTERM to process', () => {
      const executor = new AgentExecutor('test-session-6', noopLogger);
      executor.start({ prompt: 'test', workingDir: '/tmp' });
      executor.cancel();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does nothing if process not started', () => {
      const executor = new AgentExecutor('test-session-7', noopLogger);
      expect(() => executor.cancel()).not.toThrow();
    });
  });

  describe('getSessionId()', () => {
    it('returns the session ID', () => {
      const executor = new AgentExecutor('my-session-id', noopLogger);
      expect(executor.getSessionId()).toBe('my-session-id');
    });
  });
});

describe('AgentStore', () => {
  beforeEach(() => {
    mockSpawn.mockReset();

    const defaultMockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
      kill: vi.fn(),
      pid: 99999
    });
    mockSpawn.mockReturnValue(defaultMockProcess);
  });

  describe('create()', () => {
    it('creates and tracks sessions by ID', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      const executor = store.create('session-1', 'client-A');

      expect(executor).toBeInstanceOf(AgentExecutor);
      expect(store.get('session-1')).toBe(executor);
    });

    it('associates sessions with client IDs', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-A');
      store.create('session-3', 'client-B');

      const clientASessions = store.getByClient('client-A');
      expect(clientASessions).toHaveLength(2);
      expect(clientASessions.map(e => e.getSessionId())).toContain('session-1');
      expect(clientASessions.map(e => e.getSessionId())).toContain('session-2');
    });
  });

  describe('remove()', () => {
    it('removes session and returns the executor', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      const executor = store.create('session-1', 'client-A');
      const removed = store.remove('session-1');

      expect(removed).toBe(executor);
      expect(store.get('session-1')).toBeUndefined();
    });

    it('returns undefined for non-existent session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      const removed = store.remove('non-existent');

      expect(removed).toBeUndefined();
    });
  });

  describe('removeByClient()', () => {
    it('removes all sessions for a client', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-A');
      store.create('session-3', 'client-B');

      const removed = store.removeByClient('client-A');

      expect(removed).toHaveLength(2);
      expect(store.get('session-1')).toBeUndefined();
      expect(store.get('session-2')).toBeUndefined();
      expect(store.get('session-3')).toBeDefined();
    });

    it('returns empty array for non-existent client', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      const removed = store.removeByClient('non-existent');

      expect(removed).toHaveLength(0);
    });
  });

  describe('has()', () => {
    it('returns true for existing session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      store.create('session-1', 'client-A');

      expect(store.has('session-1')).toBe(true);
    });

    it('returns false for non-existent session', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));

      expect(store.has('session-1')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('returns all sessions', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-B');

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no sessions', () => {
      const store = new AgentStore(noopLogger, (id, log) => new AgentExecutor(id, log));
      expect(store.getAll()).toHaveLength(0);
    });
  });
});
