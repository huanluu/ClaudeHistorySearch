import { join } from 'path';
import { homedir } from 'os';

/**
 * Get the application config directory.
 * Defaults to ~/.claude-history-server, overridable via CLAUDE_HISTORY_CONFIG_DIR env var.
 */
export function getConfigDir(): string {
  return process.env.CLAUDE_HISTORY_CONFIG_DIR || join(homedir(), '.claude-history-server');
}
