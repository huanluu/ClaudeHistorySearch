import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';

// Create mock spawn function
const mockSpawn = jest.fn();

// Mock child_process before importing SessionExecutor
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn
}));

// Dynamic import after mock setup
const importSessions = async () => {
  // Clear the module cache to ensure fresh import with mocks
  jest.resetModules();
  return import('../src/sessions/index.js');
};

describe('SessionExecutor', () => {
  let mockProcess: {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: jest.Mock; end: jest.Mock };
    kill: jest.Mock;
    pid: number;
  } & EventEmitter;

  beforeEach(() => {
    mockSpawn.mockReset();

    // Create mock child process
    mockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: jest.fn(), end: jest.fn() },
      kill: jest.fn(),
      pid: 12345
    });

    mockSpawn.mockReturnValue(mockProcess);
  });

  describe('start()', () => {
    it('spawns claude with correct arguments for new session', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-1');
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

    it('spawns claude with --resume flag when resumeSessionId provided', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('new-session-1');
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

    it('emits message events for JSON output lines', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-2');
      const messages: unknown[] = [];

      executor.on('message', (msg) => messages.push(msg));
      executor.start({ prompt: 'test', workingDir: '/tmp' });

      // Simulate JSON output from claude
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":"Hello"}\n'));
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","message":"World"}\n'));

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ type: 'assistant', message: 'Hello' });
      expect(messages[1]).toEqual({ type: 'assistant', message: 'World' });
    });

    it('emits error events for stderr output', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-3');
      const errors: string[] = [];

      executor.on('error', (err) => errors.push(err));
      executor.start({ prompt: 'test', workingDir: '/tmp' });

      mockProcess.stderr.emit('data', Buffer.from('Error: Something went wrong\n'));

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Error: Something went wrong');
    });

    it('emits complete event with exit code', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-4');

      const completePromise = new Promise<number>((resolve) => {
        executor.on('complete', (exitCode) => resolve(exitCode));
      });

      executor.start({ prompt: 'test', workingDir: '/tmp' });
      mockProcess.emit('exit', 0);

      const exitCode = await completePromise;
      expect(exitCode).toBe(0);
    });

    it('emits complete event with non-zero exit code on error', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-5');

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
    it('sends SIGTERM to process', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-6');
      executor.start({ prompt: 'test', workingDir: '/tmp' });
      executor.cancel();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does nothing if process not started', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('test-session-7');
      // Don't call start()
      expect(() => executor.cancel()).not.toThrow();
    });
  });

  describe('getSessionId()', () => {
    it('returns the session ID', async () => {
      const { SessionExecutor } = await importSessions();

      const executor = new SessionExecutor('my-session-id');
      expect(executor.getSessionId()).toBe('my-session-id');
    });
  });
});

describe('SessionStore', () => {
  beforeEach(() => {
    mockSpawn.mockReset();

    // Create default mock process
    const defaultMockProcess = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: jest.fn(), end: jest.fn() },
      kill: jest.fn(),
      pid: 99999
    });
    mockSpawn.mockReturnValue(defaultMockProcess);
  });

  describe('create()', () => {
    it('creates and tracks sessions by ID', async () => {
      const { SessionStore, SessionExecutor } = await importSessions();

      const store = new SessionStore();
      const executor = store.create('session-1', 'client-A');

      expect(executor).toBeInstanceOf(SessionExecutor);
      expect(store.get('session-1')).toBe(executor);
    });

    it('associates sessions with client IDs', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
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
    it('removes session and returns the executor', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      const executor = store.create('session-1', 'client-A');
      const removed = store.remove('session-1');

      expect(removed).toBe(executor);
      expect(store.get('session-1')).toBeUndefined();
    });

    it('returns undefined for non-existent session', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      const removed = store.remove('non-existent');

      expect(removed).toBeUndefined();
    });
  });

  describe('removeByClient()', () => {
    it('removes all sessions for a client', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-A');
      store.create('session-3', 'client-B');

      const removed = store.removeByClient('client-A');

      expect(removed).toHaveLength(2);
      expect(store.get('session-1')).toBeUndefined();
      expect(store.get('session-2')).toBeUndefined();
      expect(store.get('session-3')).toBeDefined();
    });

    it('returns empty array for non-existent client', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      const removed = store.removeByClient('non-existent');

      expect(removed).toHaveLength(0);
    });
  });

  describe('has()', () => {
    it('returns true for existing session', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      store.create('session-1', 'client-A');

      expect(store.has('session-1')).toBe(true);
    });

    it('returns false for non-existent session', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();

      expect(store.has('session-1')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('returns all sessions', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      store.create('session-1', 'client-A');
      store.create('session-2', 'client-B');

      const all = store.getAll();
      expect(all).toHaveLength(2);
    });

    it('returns empty array when no sessions', async () => {
      const { SessionStore } = await importSessions();

      const store = new SessionStore();
      expect(store.getAll()).toHaveLength(0);
    });
  });
});
