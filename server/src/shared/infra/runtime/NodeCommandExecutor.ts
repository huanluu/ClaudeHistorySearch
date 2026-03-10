import { execSync } from 'child_process';

/**
 * Default command executor using Node's child_process.execSync.
 * Satisfies the CommandExecutor interface from features/scheduler/types
 * via structural typing (infra cannot import from features).
 */
export function createNodeCommandExecutor(): { execSync: (command: string, options?: object) => string } {
  return {
    execSync: (command: string, options?: object) => {
      return execSync(command, { encoding: 'utf-8', ...options }) as string;
    },
  };
}
