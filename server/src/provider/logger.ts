import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

type LogLevel = 'LOG' | 'ERROR' | 'WARN' | 'VERBOSE';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

export type ErrorType = 'db_error' | 'validation_error' | 'not_found' | 'service_unavailable' | 'internal_error';

export interface LogEntry {
  op?: string;
  msg: string;
  err?: unknown;
  errType?: ErrorType;
  context?: Record<string, unknown>;
  durationMs?: number;
}

export interface LoggerOptions {
  verbose?: boolean;
  console?: boolean;
}

export interface Logger {
  log(entry: LogEntry): void;
  error(entry: LogEntry): void;
  warn(entry: LogEntry): void;
  verbose(entry: LogEntry): void;
}

/**
 * Serialize an error value to a string for structured logging.
 */
function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Create a logger that writes structured JSONL to a log file.
 * Console output is off by default (file-only); opt-in via `{ console: true }`.
 */
export function createLogger(logPath: string, options: LoggerOptions = {}): Logger {
  const verbose = options.verbose ?? (process.env.LOG_VERBOSE === '1');
  const useConsole = options.console ?? false;

  // Ensure parent directory exists
  const dir = dirname(logPath);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Best effort — don't crash
  }

  // Rotate at startup if file exceeds MAX_LOG_SIZE
  try {
    if (existsSync(logPath)) {
      const stat = statSync(logPath);
      if (stat.size > MAX_LOG_SIZE) {
        renameSync(logPath, logPath + '.1');
      }
    }
  } catch {
    // Best effort — don't crash
  }

  function writeToFile(level: LogLevel, entry: LogEntry): void {
    try {
      const record: Record<string, unknown> = {
        ts: new Date().toISOString(),
        level,
        msg: entry.msg,
      };
      if (entry.op !== undefined) record.op = entry.op;
      if (entry.err !== undefined) record.err = serializeError(entry.err);
      if (entry.errType !== undefined) record.errType = entry.errType;
      if (entry.context !== undefined) record.context = entry.context;
      if (entry.durationMs !== undefined) record.durationMs = entry.durationMs;
      appendFileSync(logPath, JSON.stringify(record) + '\n');
    } catch {
      // Never crash the server due to log file issues
    }
  }

  function writeConsole(level: LogLevel, entry: LogEntry): void {
    const parts = [entry.msg];
    if (entry.op) parts.unshift(`[${entry.op}]`);
    const text = parts.join(' ');

    if (level === 'ERROR') console.error(text);
    else if (level === 'WARN') console.warn(text);
    else console.log(text);
  }

  return {
    log(entry: LogEntry): void {
      if (useConsole) writeConsole('LOG', entry);
      writeToFile('LOG', entry);
    },
    error(entry: LogEntry): void {
      if (useConsole) writeConsole('ERROR', entry);
      writeToFile('ERROR', entry);
    },
    warn(entry: LogEntry): void {
      if (useConsole) writeConsole('WARN', entry);
      writeToFile('WARN', entry);
    },
    verbose(entry: LogEntry): void {
      if (!verbose) return;
      if (useConsole) writeConsole('VERBOSE', entry);
      writeToFile('VERBOSE', entry);
    }
  };
}

// Default singleton logger — writes to ~/.claude-history-server/server.log
const DATA_DIR = join(homedir(), '.claude-history-server');
const LOG_PATH = join(DATA_DIR, 'server.log');

export const logger = createLogger(LOG_PATH);
