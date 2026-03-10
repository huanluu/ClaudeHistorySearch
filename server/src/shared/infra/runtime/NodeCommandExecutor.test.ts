import { describe, it, expect } from 'vitest';
import { createNodeCommandExecutor } from './NodeCommandExecutor';

describe('createNodeCommandExecutor', () => {
  it('execSync runs a command and returns output', () => {
    const executor = createNodeCommandExecutor();
    const result = executor.execSync('echo hello');
    expect(result.trim()).toBe('hello');
  });

  it('execSync throws on invalid command', () => {
    const executor = createNodeCommandExecutor();
    expect(() => executor.execSync('command_that_does_not_exist_abc123')).toThrow();
  });
});
