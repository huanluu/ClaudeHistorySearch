import { spawnSync } from 'child_process';

/**
 * Argv-based command runner using Node's child_process.spawnSync.
 * Never invokes a shell — command and arguments are passed directly,
 * preventing shell injection.
 *
 * Satisfies the CommandRunner interface from features/scheduler/types
 * via structural typing (infra cannot import from features).
 */
export function createNodeCommandRunner(): {
  run(command: string, args: readonly string[], options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): { stdout: string; stderr: string; exitCode: number };
} {
  return {
    run(command, args, options) {
      const result = spawnSync(command, [...args], {
        encoding: 'utf-8',
        cwd: options?.cwd,
        env: options?.env ? { ...process.env, ...options.env } : undefined,
        timeout: options?.timeout,
        shell: false,
      });

      // spawnSync sets error when the command cannot be spawned (e.g. ENOENT)
      if (result.error) {
        return {
          stdout: '',
          stderr: result.error.message,
          exitCode: -1,
        };
      }

      // status is null when killed by signal
      const exitCode = result.status ?? -1;
      const stderr = result.stderr ?? '';
      const stdout = result.stdout ?? '';

      return { stdout, stderr, exitCode };
    },
  };
}
