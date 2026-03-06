import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import type { Logger, AgentSession, SessionStartOptions, HeadlessRunOptions, CliRuntime } from '../../provider/index';
import { createLineBuffer } from './lineBuffer';

// ── Copilot-specific spawn configuration ────────────────────────────

function buildSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  // Only pass safe env vars — don't leak secrets to child process
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM_PROGRAM']) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }
  return env;
}

function buildCopilotArgs(options: SessionStartOptions): string[] {
  const args: string[] = [];
  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }
  args.push('-p', options.prompt);
  args.push('--output-format', 'json');
  args.push('--allow-all-tools');
  args.push('--no-color');
  return args;
}

// ── CopilotAgentSession (streaming, for live sessions) ──────────────

export class CopilotAgentSession extends EventEmitter implements AgentSession {
  private process: ChildProcess | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly logger: Logger,
  ) {
    super();
  }

  start(options: SessionStartOptions): void {
    const args = buildCopilotArgs(options);

    this.logger.log({ msg: 'Starting copilot session', op: 'session.spawn', context: { sessionId: this.sessionId, workingDir: options.workingDir, args } });

    this.process = spawn('copilot', args, {
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
      this.emit('error', `Failed to start copilot: ${err.message}`);
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

// ── CopilotRuntime ──────────────────────────────────────────────────

export class CopilotRuntime implements CliRuntime {
  readonly name = 'copilot';

  startSession(sessionId: string, logger: Logger): AgentSession {
    return new CopilotAgentSession(sessionId, logger);
  }

  runHeadless(options: HeadlessRunOptions, logger: Logger): Promise<{ sessionId: string | null }> {
    const args = buildCopilotArgs({ prompt: options.prompt, workingDir: options.workingDir });

    return new Promise((resolve, reject) => {
      const child = spawn('copilot', args, {
        cwd: options.workingDir,
        env: buildSpawnEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let resolved = false;
      let lastSessionId: string | null = null;

      // Copilot emits session ID in the LAST event ({type:"result", sessionId:"..."})
      // so we collect it and resolve on close.
      const handleLine = createLineBuffer((msg) => {
        const m = msg as Record<string, unknown>;
        if (m.type === 'result' && m.sessionId) {
          lastSessionId = m.sessionId as string;
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        handleLine(data);
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          if (code && code !== 0) {
            reject(new Error(`copilot exited with code ${code}`));
            return;
          }
          if (lastSessionId) {
            logger.log({ msg: `Copilot session ID extracted: ${lastSessionId}`, op: 'runtime.headless', context: { runtime: this.name } });
          } else {
            logger.log({ msg: 'Copilot process exited before returning session ID', op: 'runtime.headless', context: { runtime: this.name } });
          }
          resolve({ sessionId: lastSessionId });
        }
      });
    });
  }
}
