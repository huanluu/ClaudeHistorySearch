import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import type { Logger, AgentSession, SessionStartOptions, HeadlessRunOptions, CliRuntime } from '../../provider/index';
import { createLineBuffer } from './lineBuffer';

// ── Claude-specific spawn configuration ─────────────────────────────

function buildSpawnEnv(parentEnv: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(parentEnv)) {
    if (val !== undefined) env[key] = val;
  }
  return { ...env, CI: '1', TERM: 'dumb', NO_COLOR: '1' };
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

// ── ClaudeAgentSession (streaming, for live sessions) ───────────────

export class ClaudeAgentSession extends EventEmitter implements AgentSession {
  private process: ChildProcess | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly logger: Logger,
    private readonly parentEnv: Record<string, string | undefined>,
  ) {
    super();
  }

  start(options: SessionStartOptions): void {
    const args = buildClaudeArgs(options);

    this.logger.log({ msg: 'Starting claude session', op: 'session.spawn', context: { sessionId: this.sessionId, workingDir: options.workingDir, args } });

    this.process = spawn('claude', args, {
      cwd: options.workingDir,
      env: buildSpawnEnv(this.parentEnv),
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
  readonly trackedProcesses = new Set<ChildProcess>();

  constructor(private readonly parentEnv: Record<string, string | undefined>) {}

  startSession(sessionId: string, logger: Logger): AgentSession {
    return new ClaudeAgentSession(sessionId, logger, this.parentEnv);
  }

  cleanup(): void {
    for (const child of this.trackedProcesses) {
      child.kill('SIGTERM');
    }
    this.trackedProcesses.clear();
  }

  runHeadless(options: HeadlessRunOptions, logger: Logger): Promise<{ sessionId: string | null }> {
    const args = buildClaudeArgs({ prompt: options.prompt, workingDir: options.workingDir });

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd: options.workingDir,
        env: buildSpawnEnv(this.parentEnv),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.trackedProcesses.add(child);
      let resolved = false;

      const handleLine = createLineBuffer((msg) => {
        if (resolved) return;
        const m = msg as Record<string, unknown>;
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
          resolved = true;
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
        this.trackedProcesses.delete(child);
        if (!resolved) {
          resolved = true;
          logger.log({ msg: 'Claude process exited before returning session ID', op: 'runtime.headless', context: { runtime: this.name } });
          resolve({ sessionId: null });
        }
      });
    });
  }
}
