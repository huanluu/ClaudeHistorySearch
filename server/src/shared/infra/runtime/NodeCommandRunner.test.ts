import { describe, it, expect } from 'vitest';
import { createNodeCommandRunner } from './NodeCommandRunner';

describe('createNodeCommandRunner', () => {
  it('runs a command and returns stdout, stderr, exitCode', () => {
    const runner = createNodeCommandRunner();
    const result = runner.run('echo', ['hello']);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exitCode and stderr without throwing', () => {
    const runner = createNodeCommandRunner();
    // ls on a non-existent path returns exit code 1 with stderr
    const result = runner.run('ls', ['/nonexistent-path-abc123']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('returns exitCode -1 with error message for command not found', () => {
    const runner = createNodeCommandRunner();
    const result = runner.run('command_that_does_not_exist_abc123', []);
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain('ENOENT');
  });

  it('passes arguments as separate argv elements (no shell splitting)', () => {
    const runner = createNodeCommandRunner();
    // echo with a single argument containing spaces — should be one argv element
    const result = runner.run('echo', ['hello world with spaces']);
    expect(result.stdout.trim()).toBe('hello world with spaces');
    expect(result.exitCode).toBe(0);
  });
});
