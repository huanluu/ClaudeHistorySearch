import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';

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
  private process: ChildProcess | null = null;
  private buffer: string = '';

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
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

    // Spawn claude process
    this.process = spawn('claude', args, {
      cwd: options.workingDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdout (JSON lines)
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleStdout(data);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.emit('error', text);
      }
    });

    // Handle process exit
    this.process.on('exit', (code: number | null) => {
      this.emit('complete', code ?? 0);
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
