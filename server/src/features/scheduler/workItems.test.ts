import { describe, it, expect } from 'vitest';
import { checkForChanges, buildWorkItemPrompt } from './workItems';
import type { CommandExecutor, WorkItem } from './types';

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

describe('checkForChanges', () => {
  it('returns new items when no previous state exists', async () => {
    const item = makeWorkItem(1);
    const executor: CommandExecutor = {
      execSync: () => JSON.stringify([item]),
    };
    const result = await checkForChanges(executor, () => undefined);
    expect(result.newItems).toEqual([item]);
    expect(result.updatedItems).toEqual([]);
  });

  it('returns updated items when changed date differs', async () => {
    const item = makeWorkItem(1, { 'System.ChangedDate': '2026-02-01T00:00:00Z' });
    const executor: CommandExecutor = {
      execSync: () => JSON.stringify([item]),
    };
    const result = await checkForChanges(executor, () => '2026-01-01T00:00:00Z');
    expect(result.newItems).toEqual([]);
    expect(result.updatedItems).toEqual([item]);
  });

  it('skips unchanged items', async () => {
    const item = makeWorkItem(1);
    const executor: CommandExecutor = {
      execSync: () => JSON.stringify([item]),
    };
    const result = await checkForChanges(executor, () => '2026-01-01T00:00:00Z');
    expect(result.newItems).toEqual([]);
    expect(result.updatedItems).toEqual([]);
  });

  it('captures errors without throwing', async () => {
    const executor: CommandExecutor = {
      execSync: () => { throw new Error('az CLI failed'); },
    };
    const result = await checkForChanges(executor, () => undefined);
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
