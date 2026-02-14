import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { format } from 'util';

type LogLevel = 'LOG' | 'ERROR' | 'WARN' | 'VERBOSE';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB

export interface LoggerOptions {
  verbose?: boolean;
  console?: boolean;
}

export interface Logger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  verbose(...args: unknown[]): void;
}

/**
 * Create a logger that dual-writes to console and a log file.
 * Exported as a factory for testing (pass a custom logPath).
 */
export function createLogger(logPath: string, options: LoggerOptions = {}): Logger {
  const verbose = options.verbose ?? (process.env.LOG_VERBOSE === '1');
  const useConsole = options.console ?? true;

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

  function writeToFile(level: LogLevel, args: unknown[]): void {
    try {
      const timestamp = new Date().toISOString();
      const message = format(...args);
      appendFileSync(logPath, `${timestamp} [${level}] ${message}\n`);
    } catch {
      // Never crash the server due to log file issues
    }
  }

  return {
    log(...args: unknown[]): void {
      if (useConsole) console.log(...args);
      writeToFile('LOG', args);
    },
    error(...args: unknown[]): void {
      if (useConsole) console.error(...args);
      writeToFile('ERROR', args);
    },
    warn(...args: unknown[]): void {
      if (useConsole) console.warn(...args);
      writeToFile('WARN', args);
    },
    verbose(...args: unknown[]): void {
      if (!verbose) return;
      if (useConsole) console.log(...args);
      writeToFile('VERBOSE', args);
    }
  };
}

// Default singleton logger — writes to ~/.claude-history-server/server.log
const DATA_DIR = join(homedir(), '.claude-history-server');
const LOG_PATH = join(DATA_DIR, 'server.log');

export const logger = createLogger(LOG_PATH);
