import { EventEmitter } from 'events';
import { CopilotAgentSession, CopilotRuntime } from './CopilotRuntime';
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

describe('CopilotAgentSession', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;

  beforeEach(() => {
    mockSpawn.mockReset();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  it('spawns copilot with correct arguments for new session', () => {
    const session = new CopilotAgentSession('test-1', noopLogger, process.env);
    session.start({ prompt: 'List files', workingDir: '/tmp/test' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['-p', 'List files', '--output-format', 'json', '--allow-all-tools', '--no-color']),
      expect.objectContaining({ cwd: '/tmp/test' })
    );
  });

  it('does not include --verbose or --dangerously-skip-permissions', () => {
    const session = new CopilotAgentSession('test-2', noopLogger, process.env);
    session.start({ prompt: 'test', workingDir: '/tmp' });

    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).not.toContain('--verbose');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('spawns with --resume flag when resumeSessionId provided', () => {
    const session = new CopilotAgentSession('test-3', noopLogger, process.env);
    session.start({ prompt: 'continue', workingDir: '/tmp', resumeSessionId: 'abc-123' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['--resume', 'abc-123', '-p', 'continue']),
      expect.any(Object)
    );
  });

  it('passes only safe env vars (no CI/TERM/NO_COLOR, no secrets)', () => {
    const session = new CopilotAgentSession('test-4', noopLogger, process.env);
    session.start({ prompt: 'test', workingDir: '/tmp' });

    const env = mockSpawn.mock.calls[0][2].env;
    // Should not include Claude-specific vars
    expect(env).not.toHaveProperty('CI');
    expect(env).not.toHaveProperty('TERM');
    expect(env).not.toHaveProperty('NO_COLOR');
    // Should only contain safe vars from the allowlist
    const keys = Object.keys(env);
    for (const key of keys) {
      expect(['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM_PROGRAM']).toContain(key);
    }
  });

  it('emits message events for JSON output lines', () => {
    const session = new CopilotAgentSession('test-5', noopLogger, process.env);
    const messages: unknown[] = [];
    session.on('message', (msg) => messages.push(msg));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant.message","text":"Hello"}\n'));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: 'assistant.message', text: 'Hello' });
  });

  it('emits error events for stderr output', () => {
    const session = new CopilotAgentSession('test-6', noopLogger, process.env);
    const errors: string[] = [];
    session.on('error', (err) => errors.push(err));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.stderr.emit('data', Buffer.from('Something went wrong\n'));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('Something went wrong');
  });

  it('emits complete event with exit code', async () => {
    const session = new CopilotAgentSession('test-7', noopLogger, process.env);
    const p = new Promise<number>((resolve) => session.on('complete', resolve));
    session.start({ prompt: 'test', workingDir: '/tmp' });

    mockProcess.emit('exit', 0);
    expect(await p).toBe(0);
  });

  it('cancel sends SIGTERM', () => {
    const session = new CopilotAgentSession('test-8', noopLogger, process.env);
    session.start({ prompt: 'test', workingDir: '/tmp' });
    session.cancel();
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('getSessionId returns the session ID', () => {
    const session = new CopilotAgentSession('my-id', noopLogger, process.env);
    expect(session.getSessionId()).toBe('my-id');
  });
});

describe('CopilotRuntime', () => {
  let mockProcess: ReturnType<typeof createMockProcess>;
  const runtime = new CopilotRuntime(process.env);

  beforeEach(() => {
    mockSpawn.mockReset();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  it('has name "copilot"', () => {
    expect(runtime.name).toBe('copilot');
  });

  it('startSession returns a CopilotAgentSession', () => {
    const session = runtime.startSession('s1', noopLogger);
    expect(session.getSessionId()).toBe('s1');
    expect(typeof session.start).toBe('function');
    expect(typeof session.cancel).toBe('function');
  });

  describe('runHeadless', () => {
    it('extracts session ID from last result event', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      // Copilot emits various events, session ID is in the LAST one
      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant.message","text":"hello"}\n'));
      mockProcess.stdout.emit('data', Buffer.from('{"type":"result","sessionId":"copilot-uuid-123"}\n'));
      mockProcess.emit('close');

      const result = await promise;
      expect(result.sessionId).toBe('copilot-uuid-123');
    });

    it('returns null sessionId if process exits without result event', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.stdout.emit('data', Buffer.from('{"type":"assistant.message","text":"hello"}\n'));
      mockProcess.emit('close');

      const result = await promise;
      expect(result.sessionId).toBeNull();
    });

    it('rejects on non-zero exit code', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.emit('close', 1);

      await expect(promise).rejects.toThrow('copilot exited with code 1');
    });

    it('rejects on spawn error', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.emit('error', new Error('ENOENT'));

      await expect(promise).rejects.toThrow('ENOENT');
    });

    it('uses last result event if multiple are emitted', async () => {
      const promise = runtime.runHeadless({ prompt: 'analyze', workingDir: '/tmp' }, noopLogger);

      mockProcess.stdout.emit('data', Buffer.from('{"type":"result","sessionId":"first-id"}\n'));
      mockProcess.stdout.emit('data', Buffer.from('{"type":"result","sessionId":"last-id"}\n'));
      mockProcess.emit('close');

      const result = await promise;
      expect(result.sessionId).toBe('last-id');
    });
  });
});
