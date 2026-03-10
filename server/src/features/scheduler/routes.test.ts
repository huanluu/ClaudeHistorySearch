import request from 'supertest';
import express, { type Application } from 'express';
import { Router } from 'express';
import { registerSchedulerRoutes, type SchedulerRouteDeps } from './index';
import type { HeartbeatService } from './HeartbeatService';
import { noopLogger } from '../../../tests/__helpers/index';

function createSchedulerApp(heartbeatService?: SchedulerRouteDeps['heartbeatService']): Application {
  const app = express();
  app.use(express.json());

  const router = Router();
  registerSchedulerRoutes(router, { heartbeatService, logger: noopLogger });
  app.use('/', router);

  return app;
}

describe('POST /heartbeat', () => {
  it('should return 503 when heartbeatService not provided', async () => {
    const app = createSchedulerApp();
    const res = await request(app).post('/heartbeat');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Heartbeat service not initialized');
  });

  it('should call runHeartbeat(true) and return result', async () => {
    const mockResult = { tasksProcessed: 1, sessionsCreated: 0, sessionIds: [], errors: [] };
    const mockHeartbeat = { runHeartbeat: vi.fn().mockResolvedValue(mockResult) };
    const app = createSchedulerApp(mockHeartbeat as unknown as HeartbeatService);

    const res = await request(app).post('/heartbeat');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockResult);
    expect(mockHeartbeat.runHeartbeat).toHaveBeenCalledWith(true);
  });
});

describe('GET /heartbeat/status', () => {
  it('should return defaults when heartbeatService not provided', async () => {
    const app = createSchedulerApp();

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      intervalMs: 0,
      workingDirectory: '',
      state: [],
    });
  });

  it('should return mapped state from heartbeatService', async () => {
    const mockHeartbeat = {
      getAllState: vi.fn().mockReturnValue([
        { key: 'item-1', last_changed: '2025-01-01', last_processed: '2025-01-01' },
      ]),
      getConfig: vi.fn().mockReturnValue({
        enabled: true,
        intervalMs: 120000,
        workingDirectory: '/tmp/work',
      }),
    };
    const app = createSchedulerApp(mockHeartbeat as unknown as HeartbeatService);

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.intervalMs).toBe(120000);
    expect(res.body.workingDirectory).toBe('/tmp/work');
    expect(res.body.state).toEqual([
      { key: 'item-1', lastChanged: '2025-01-01', lastProcessed: '2025-01-01' },
    ]);
  });

  it('should return 500 when getAllState throws', async () => {
    const mockHeartbeat = {
      getAllState: vi.fn().mockImplementation(() => { throw new Error('db error'); }),
      getConfig: vi.fn().mockReturnValue({ enabled: false, intervalMs: 0, workingDirectory: '' }),
    };
    const app = createSchedulerApp(mockHeartbeat as unknown as HeartbeatService);

    const res = await request(app).get('/heartbeat/status');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to get heartbeat status');
  });
});
