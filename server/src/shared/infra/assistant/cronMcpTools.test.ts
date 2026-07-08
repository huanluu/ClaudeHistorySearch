import { describe, it, expect, vi } from 'vitest';
import { createCronTools } from './cronMcpTools';
import type { CronToolService, CronJobRecord } from '../../provider/index';

function makeJob(overrides: Partial<CronJobRecord> = {}): CronJobRecord {
  return {
    id: 'job-1',
    name: 'Test Job',
    enabled: 1,
    schedule_kind: 'every',
    schedule_value: '3600000',
    schedule_timezone: null,
    prompt: 'Do something',
    working_dir: '/tmp',
    runtime: 'copilot',
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

describe('createCronTools', () => {
  it('returns Copilot custom cron tools', () => {
    const service = makeMockService();
    const tools = createCronTools(service);
    expect(tools.map(tool => tool.name)).toEqual([
      'cron_add', 'cron_list', 'cron_status', 'cron_run', 'cron_update', 'cron_remove',
    ]);
  });

  it('tool handlers delegate to the cron service', async () => {
    const service = makeMockService();
    const tools = createCronTools(service);
    const list = tools.find(tool => tool.name === 'cron_list');
    expect(list?.handler).toBeDefined();
    const result = await list!.handler!({}, { sessionId: 's1', toolCallId: 't1', toolName: 'cron_list', arguments: {} });
    expect(result).toContain('Test Job');
    expect(service.listJobs).toHaveBeenCalled();
  });
});
