import { describe, it, expect, vi } from 'vitest';
import { checkForChanges, buildWorkItemPrompt } from './workItems';
import type { CommandRunner, WorkItem } from './types';

function makeWorkItem(id: number, overrides: Partial<WorkItem['fields']> = {}): WorkItem {
  return {
    id,
    fields: {
      'System.Title': `Work Item ${id}`,
      'System.State': 'Active',
      'System.ChangedDate': '2026-01-01T00:00:00Z',
      ...overrides,
    },
  };
}

function mockRunner(stdout: string, exitCode = 0, stderr = ''): CommandRunner {
  return {
    run: vi.fn().mockReturnValue({ stdout, stderr, exitCode }),
  };
}

describe('checkForChanges', () => {
  it('returns new items when no previous state exists', async () => {
    const item = makeWorkItem(1);
    const runner = mockRunner(JSON.stringify([item]));
    const result = await checkForChanges(runner, () => undefined);
    expect(result.newItems).toEqual([item]);
    expect(result.updatedItems).toEqual([]);
  });

  it('returns updated items when changed date differs', async () => {
    const item = makeWorkItem(1, { 'System.ChangedDate': '2026-02-01T00:00:00Z' });
    const runner = mockRunner(JSON.stringify([item]));
    const result = await checkForChanges(runner, () => '2026-01-01T00:00:00Z');
    expect(result.newItems).toEqual([]);
    expect(result.updatedItems).toEqual([item]);
  });

  it('skips unchanged items', async () => {
    const item = makeWorkItem(1);
    const runner = mockRunner(JSON.stringify([item]));
    const result = await checkForChanges(runner, () => '2026-01-01T00:00:00Z');
    expect(result.newItems).toEqual([]);
    expect(result.updatedItems).toEqual([]);
  });

  it('captures non-zero exit code as error with stderr', async () => {
    const runner = mockRunner('', 1, 'auth failed');
    const result = await checkForChanges(runner, () => undefined);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('auth failed');
    expect(result.errors[0]).toContain('exit 1');
  });

  it('passes az as command and WIQL as single argv element', async () => {
    const item = makeWorkItem(1);
    const runner = mockRunner(JSON.stringify([item]));
    await checkForChanges(runner, () => undefined);

    expect(runner.run).toHaveBeenCalledOnce();
    const [command, args] = (runner.run as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(command).toBe('az');
    expect(args[0]).toBe('boards');
    expect(args[1]).toBe('query');
    expect(args[2]).toBe('--wiql');
    // WIQL with spaces and quotes is a single argv element
    expect(args[3]).toContain('SELECT');
    expect(args[3]).toContain("'Closed'");
    expect(args[4]).toBe('-o');
    expect(args[5]).toBe('json');
  });

  it('captures malformed JSON output as error', async () => {
    const runner = mockRunner('not valid json', 0);
    const result = await checkForChanges(runner, () => undefined);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Failed to parse');
  });

  it('captures errors from runner failures without throwing', async () => {
    const runner: CommandRunner = {
      run: () => { throw new Error('az CLI failed'); },
    };
    const result = await checkForChanges(runner, () => undefined);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('az CLI failed');
  });
});

describe('buildWorkItemPrompt', () => {
  it('includes work item details in the prompt', () => {
    const item = makeWorkItem(42, {
      'System.Title': 'Fix the widget',
      'System.State': 'Active',
      'System.WorkItemType': 'Bug',
    });
    const prompt = buildWorkItemPrompt(item);
    expect(prompt).toContain('Work Item #42');
    expect(prompt).toContain('Fix the widget');
    expect(prompt).toContain('Bug');
  });

  it('includes description when present', () => {
    const item = makeWorkItem(1, { 'System.Description': 'Detailed description here' });
    const prompt = buildWorkItemPrompt(item);
    expect(prompt).toContain('Detailed description here');
  });
});
