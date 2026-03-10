import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerCronRoutes } from './routes';
import type { CronService } from './CronService';
import type { Logger } from '../../shared/provider/index';
import type { CronJobRecord } from '../../shared/provider/index';

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

function setup(cronOverrides: Partial<CronService> = {}) {
  const cronService = {
    listJobs: vi.fn().mockReturnValue([makeJob()]),
    getJobStatus: vi.fn().mockReturnValue(makeJob()),
    addJob: vi.fn().mockReturnValue(makeJob()),
    updateJob: vi.fn().mockReturnValue(makeJob({ name: 'Updated' })),
    removeJob: vi.fn(),
    runJobNow: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
    ...cronOverrides,
  } as unknown as CronService;

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), verbose: vi.fn() } as unknown as Logger;
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerCronRoutes(router, { cronService, logger });
  app.use(router);
  return { app, cronService, logger };
}

describe('cron routes', () => {
  it('GET /cron/jobs returns all jobs', async () => {
    const { app } = setup();
    const res = await request(app).get('/cron/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Test Job');
  });

  it('GET /cron/jobs/:id returns a job', async () => {
    const { app } = setup();
    const res = await request(app).get('/cron/jobs/job-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('job-1');
  });

  it('GET /cron/jobs/:id returns 404 for missing job', async () => {
    const { app } = setup({
      getJobStatus: vi.fn().mockImplementation(() => { throw new Error('Cron job not found: nope'); }),
    } as unknown as Partial<CronService>);
    const res = await request(app).get('/cron/jobs/nope');
    expect(res.status).toBe(404);
  });

  it('POST /cron/jobs creates a job', async () => {
    const { app, cronService } = setup();
    const res = await request(app).post('/cron/jobs').send({
      name: 'New Job',
      schedule: { kind: 'every', value: '60000' },
      prompt: 'Do stuff',
      workingDir: '/tmp',
    });
    expect(res.status).toBe(201);
    expect(cronService.addJob).toHaveBeenCalled();
  });

  it('POST /cron/jobs returns 400 for missing fields', async () => {
    const { app } = setup();
    const res = await request(app).post('/cron/jobs').send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('PUT /cron/jobs/:id updates a job', async () => {
    const { app } = setup();
    const res = await request(app).put('/cron/jobs/job-1').send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('DELETE /cron/jobs/:id removes a job', async () => {
    const { app } = setup();
    const res = await request(app).delete('/cron/jobs/job-1');
    expect(res.status).toBe(204);
  });

  it('DELETE /cron/jobs/:id returns 404 for missing job', async () => {
    const { app } = setup({
      removeJob: vi.fn().mockImplementation(() => { throw new Error('Cron job not found: nope'); }),
    } as unknown as Partial<CronService>);
    const res = await request(app).delete('/cron/jobs/nope');
    expect(res.status).toBe(404);
  });

  it('POST /cron/jobs/:id/run triggers a job', async () => {
    const { app } = setup();
    const res = await request(app).post('/cron/jobs/job-1/run');
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('sess-1');
  });
});
