import { describe, it, expect } from 'vitest';
import { parseHeartbeatConfig, parseHeartbeatContent } from './heartbeatParser';

describe('parseHeartbeatConfig', () => {
  it('returns defaults when no file config provided', () => {
    const config = parseHeartbeatConfig(null, {});
    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(3600000);
    expect(config.maxItems).toBe(0);
    expect(config.maxRuns).toBe(0);
  });

  it('overrides defaults from file config', () => {
    const config = parseHeartbeatConfig(
      { heartbeat: { enabled: false, intervalMs: 60000 } },
      {},
    );
    expect(config.enabled).toBe(false);
    expect(config.intervalMs).toBe(60000);
  });

  it('ignores fields with wrong types', () => {
    const config = parseHeartbeatConfig(
      { heartbeat: { enabled: 'yes', intervalMs: '1000' } },
      {},
    );
    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(3600000);
  });

  it('env overrides take precedence over file config', () => {
    const config = parseHeartbeatConfig(
      { heartbeat: { enabled: false } },
      { enabled: true, maxRuns: 5 },
    );
    expect(config.enabled).toBe(true);
    expect(config.maxRuns).toBe(5);
  });
});

describe('parseHeartbeatContent', () => {
  it('returns empty array for empty content', () => {
    expect(parseHeartbeatContent('')).toEqual([]);
    expect(parseHeartbeatContent('  \n  ')).toEqual([]);
  });

  it('parses enabled checklist items', () => {
    const content = '## Tasks\n- [x] Do something\n- [ ] Skip this';
    const tasks = parseHeartbeatContent(content);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({ section: 'Tasks', description: 'Do something', enabled: true });
  });

  it('tracks section headers', () => {
    const content = '## A\n- [x] Task A\n## B\n- [x] Task B';
    const tasks = parseHeartbeatContent(content);
    expect(tasks[0].section).toBe('A');
    expect(tasks[1].section).toBe('B');
  });

  it('uses Default section when no header precedes items', () => {
    const tasks = parseHeartbeatContent('- [x] Orphan task');
    expect(tasks[0].section).toBe('Default');
  });
});
