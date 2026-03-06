import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import type { Logger, AgentSession, SessionStartOptions, HeadlessRunOptions, CliRuntime } from '../../provider/index';

// ── Shared spawn configuration ──────────────────────────────────────

function buildSpawnEnv(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    CI: '1',
    TERM: 'dumb',
    NO_COLOR: '1'
  };
}

function buildClaudeArgs(options: SessionStartOptions): string[] {
  const args: string[] = [];
  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }
  args.push('-p', options.prompt);
  args.push('--output-format', 'stream-json');
  args.push('--verbose');
  args.push('--dangerously-skip-permissions');
  return args;
}

// ── JSONL line buffer ───────────────────────────────────────────────

function createLineBuffer(onLine: (parsed: unknown) => void, onRaw?: (line: string) => void): (data: Buffer) => void {
  let buffer = '';
  return (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          onLine(JSON.parse(trimmed));
        } catch {
          onRaw?.(trimmed);
        }
      }
    }
  };
}

// ── ClaudeAgentSession (streaming, for live sessions) ───────────────

export class ClaudeAgentSession extends EventEmitter implements AgentSession {
  private process: ChildProcess | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly logger: Logger,
  ) {
    super();
  }

  start(options: SessionStartOptions): void {
    const args = buildClaudeArgs(options);

    this.logger.log({ msg: 'Starting claude session', op: 'session.spawn', context: { sessionId: this.sessionId, workingDir: options.workingDir, args } });

    this.process = spawn('claude', args, {
      cwd: options.workingDir,
      env: buildSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.logger.log({ msg: `Process spawned with PID: ${this.process.pid}`, op: 'session.spawn', context: { sessionId: this.sessionId, pid: this.process.pid } });

    const handleLine = createLineBuffer(
      (message) => this.emit('message', message),
      (raw) => this.emit('raw', raw),
    );

    this.process.stdout?.on('data', (data: Buffer) => {
      this.logger.verbose({ msg: `stdout: ${data.toString().substring(0, 100)}...`, op: 'session.output', context: { sessionId: this.sessionId } });
      handleLine(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      this.logger.verbose({ msg: `stderr: ${text}`, op: 'session.output', context: { sessionId: this.sessionId } });
      if (text) {
        this.emit('error', text);
      }
    });

    this.process.on('exit', (code: number | null) => {
      this.logger.log({ msg: `Process exited with code: ${code}`, op: 'session.exit', context: { sessionId: this.sessionId, exitCode: code } });
      this.emit('complete', code ?? 0);
    });

    this.process.on('error', (err) => {
      this.logger.error({ msg: `Spawn error: ${err.message}`, op: 'session.error', err, context: { sessionId: this.sessionId } });
      this.emit('error', `Failed to start claude: ${err.message}`);
    });
  }

  cancel(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

// ── ClaudeRuntime ───────────────────────────────────────────────────

export class ClaudeRuntime implements CliRuntime {
  readonly name = 'claude';

  startSession(sessionId: string, logger: Logger): AgentSession {
    return new ClaudeAgentSession(sessionId, logger);
  }

  runHeadless(options: HeadlessRunOptions, logger: Logger): Promise<{ sessionId: string | null }> {
    const args = buildClaudeArgs({ prompt: options.prompt, workingDir: options.workingDir });

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd: options.workingDir,
        env: buildSpawnEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let resolved = false;

      const handleLine = createLineBuffer((msg) => {
        if (resolved) return;
        const m = msg as Record<string, unknown>;
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
          resolved = true;
          child.unref();
          resolve({ sessionId: m.session_id as string });
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        if (!resolved) handleLine(data);
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      child.on('close', () => {
        if (!resolved) {
          resolved = true;
          logger.log({ msg: 'Claude process exited before returning session ID', op: 'runtime.headless', context: { runtime: this.name } });
          resolve({ sessionId: null });
        }
      });
    });
  }
}
