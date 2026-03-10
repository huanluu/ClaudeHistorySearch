import { describe, it, expect, vi } from 'vitest';
import { createCronMcpTools } from './cronMcpTools';
import type { CronToolService, CronJobRecord } from '../../provider/index';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    name: 'Test Job',
    enabled: 1,
    schedule_kind: 'every',
    schedule_value: '3600000',
    prompt: 'Do something',
    working_dir: '/tmp',
    runtime: 'claude',
    next_run_at_ms: Date.now() + 3600000,
    last_run_at_ms: null,
    last_run_status: null,
    last_session_id: null,
    consecutive_errors: 0,
    created_at_ms: Date.now(),
    ...overrides,
  };
}

function makeMockService(): CronToolService {
  return {
    addJob: vi.fn().mockReturnValue(makeJob()),
    listJobs: vi.fn().mockReturnValue([makeJob()]),
    getJobStatus: vi.fn().mockReturnValue(makeJob()),
    updateJob: vi.fn().mockReturnValue(makeJob({ name: 'Updated' })),
    removeJob: vi.fn(),
    runJobNow: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
  };
}

describe('createCronMcpTools', () => {
  it('returns an MCP server with name "cron"', () => {
    const service = makeMockService();
    const server = createCronMcpTools(service);
    expect(server.name).toBe('cron');
    expect(server.type).toBe('sdk');
  });

  it('server has an instance property', () => {
    const service = makeMockService();
    const server = createCronMcpTools(service);
    expect(server.instance).toBeDefined();
  });
});
