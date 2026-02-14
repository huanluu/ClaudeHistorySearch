import { EventEmitter } from 'events';
import { spawn, type ChildProcess } from 'child_process';
import { logger as defaultLogger } from '../provider/index.js';
import type { Logger } from '../provider/index.js';

export interface SessionStartOptions {
  prompt: string;
  workingDir: string;
  resumeSessionId?: string;
}

/**
 * Executes a Claude Code session using `claude -p` headless mode.
 * Emits events for message output, errors, and completion.
 */
export class SessionExecutor extends EventEmitter {
  private sessionId: string;
  private logger: Logger;
  private process: ChildProcess | null = null;
  private buffer: string = '';

  constructor(sessionId: string, logger: Logger = defaultLogger) {
    super();
    this.sessionId = sessionId;
    this.logger = logger;
  }

  /**
   * Start the Claude session.
   */
  start(options: SessionStartOptions): void {
    const args: string[] = [];

    // Add --resume flag if resuming a session
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    // Add prompt and output format
    args.push('-p', options.prompt);
    args.push('--output-format', 'stream-json');
    args.push('--verbose');  // Required for stream-json with -p
    // Skip permission prompts for headless operation
    args.push('--dangerously-skip-permissions');

    this.logger.log({ msg: `Starting claude session`, op: 'session.spawn', context: { sessionId: this.sessionId, workingDir: options.workingDir, args } });

    // Spawn claude process with environment variables for non-TTY operation
    // CI=1, TERM=dumb, NO_COLOR=1 forces claude into non-interactive mode
    this.process = spawn('claude', args, {
      cwd: options.workingDir,
      env: {
        ...process.env,
        CI: '1',
        TERM: 'dumb',
        NO_COLOR: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']  // stdin=ignore for non-interactive
    });

    this.logger.log({ msg: `Process spawned with PID: ${this.process.pid}`, op: 'session.spawn', context: { sessionId: this.sessionId, pid: this.process.pid } });

    // Handle stdout (JSON lines)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.logger.verbose({ msg: `stdout: ${data.toString().substring(0, 100)}...`, op: 'session.output', context: { sessionId: this.sessionId } });
      this.handleStdout(data);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      this.logger.verbose({ msg: `stderr: ${text}`, op: 'session.output', context: { sessionId: this.sessionId } });
      if (text) {
        this.emit('error', text);
      }
    });

    // Handle process exit
    this.process.on('exit', (code: number | null) => {
      this.logger.log({ msg: `Process exited with code: ${code}`, op: 'session.exit', context: { sessionId: this.sessionId, exitCode: code } });
      this.emit('complete', code ?? 0);
    });

    // Handle spawn errors
    this.process.on('error', (err) => {
      this.logger.error({ msg: `Spawn error: ${err.message}`, op: 'session.error', err, context: { sessionId: this.sessionId } });
      this.emit('error', `Failed to start claude: ${err.message}`);
    });
  }

  /**
   * Cancel the running session by sending SIGTERM.
   */
  cancel(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Handle stdout data, parsing JSON lines.
   */
  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const message = JSON.parse(trimmed);
          this.emit('message', message);
        } catch {
          // Non-JSON line, emit as raw
          this.emit('raw', trimmed);
        }
      }
    }
  }
}
