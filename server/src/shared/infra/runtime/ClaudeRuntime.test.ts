import { EventEmitter } from 'events';

import { ClaudeAgentSession, ClaudeRuntime } from './ClaudeRuntime';
import { noopLogger } from '../../../../tests/__helpers/index';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

function createMockProcess() {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    pid: 12345,
    unref: vi.fn(),
  });
}

describe('ClaudeAgentSession', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    mockSpawn.mockReset();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  it('spawns claude with correct arguments for new session', () => {
    const session = new ClaudeAgentSession('test-1', noopLogger);
    session.start({ prompt: 'List files', workingDir: '/tmp/test' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['-p', 'List files', '--output-format', 'stream-json']),
      expect.objectContaining({ cwd: '/tmp/test' })
    );
  });

  it('spawns claude with --resume flag when resumeSessionId provided', () => {
    const session = new ClaudeAgentSession('test-2', noopLogger);
    session.start({ prompt: 'continue', workingDir: '/tmp', resumeSessionId: 'abc-123' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--resume', 'abc-123', '-p', 'continue']),
      expect.any(Object)
    );
  });

  it('sets CI=1, TERM=dumb, NO_COLOR=1 env vars', () => {
    const session = new ClaudeAgentSession('test-3', noopLogger);
    session.start({ prompt: 'test', workingDir: '/tmp' });

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.CI).toBe('1');
    expect(env.TERM).toBe('dumb');
    expect(env.NO_COLOR).toBe('1');
  });

  it('emits message events for JSON output lines', () => {
    const session = new ClaudeAgentSession('test-4', noopLogger);
    const messages: unknown[] = [];
    session.on('message', (msg) => messages.push(msg));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","text":"Hello"}\n'));
    mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","text":"World"}\n'));

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'assistant', text: 'Hello' });
  });

  it('emits error events for stderr output', () => {
    const session = new ClaudeAgentSession('test-5', noopLogger);
    const errors: string[] = [];
    session.on('error', (err) => errors.push(err));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.stderr.emit('data', Buffer.from('Something went wrong\n'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('Something went wrong');
  });

  it('emits complete event with exit code', async () => {
    const session = new ClaudeAgentSession('test-6', noopLogger);
    const p = new Promise<number>((resolve) => session.on('complete', resolve));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.emit('exit', 0);
    expect(await p).toBe(0);
  });

  it('cancel sends SIGTERM', () => {
    const session = new ClaudeAgentSession('test-7', noopLogger);
    session.start({ prompt: 'test', workingDir: '/tmp' });
    session.cancel();
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('getSessionId returns the session ID', () => {
    const session = new ClaudeAgentSession('my-id', noopLogger);
    expect(session.getSessionId()).toBe('my-id');
  });
});

describe('ClaudeRuntime', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  const runtime = new ClaudeRuntime();

  beforeEach(() => {
    mockSpawn.mockReset();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  it('has name "claude"', () => {
    expect(runtime.name).toBe('claude');
  });

  it('startSession returns a ClaudeAgentSession', () => {
    const session = runtime.startSession('s1', noopLogger);
    expect(session.getSessionId()).toBe('s1');
    expect(typeof session.start).toBe('function');
    expect(typeof session.cancel).toBe('function');
  });

  describe('runHeadless', () => {
    it('extracts session ID from init message', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      // Simulate Claude outputting an init message
      mockProcess.stdout.emit('data', Buffer.from(
        '{"type":"system","subtype":"init","session_id":"extracted-uuid"}\n'
      ));

      const result = await promise;
      expect(result.sessionId).toBe('extracted-uuid');
    });

    it('unrefs child after extracting session ID', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.stdout.emit('data', Buffer.from(
        '{"type":"system","subtype":"init","session_id":"uuid-123"}\n'
      ));

      await promise;
      expect(mockProcess.unref).toHaveBeenCalled();
    });

    it('returns null sessionId if process exits before init', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.emit('close');

      const result = await promise;
      expect(result.sessionId).toBeNull();
    });

    it('rejects on spawn error', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('ENOENT');
    });

    it('ignores non-init messages', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      // Emit a non-init message first
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant","text":"hello"}\n'));
      // Then the init message
      mockProcess.stdout.emit('data', Buffer.from('{"type":"system","subtype":"init","session_id":"the-id"}\n'));

      const result = await promise;
      expect(result.sessionId).toBe('the-id');
    });
  });
});
