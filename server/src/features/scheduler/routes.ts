import { type Router, type Request, type Response } from 'express';
import type { Logger } from '../../shared/provider/index';
import type { HeartbeatService } from './HeartbeatService';

export interface SchedulerRouteDeps {
  heartbeatService?: HeartbeatService;
  logger: Logger;
}

export function registerSchedulerRoutes(router: Router, deps: SchedulerRouteDeps): void {
  const { heartbeatService, logger } = deps;

  /**
   * POST /heartbeat
   * Manually trigger a heartbeat run
   */
  router.post('/heartbeat', async (_req: Request, res: Response) => {
    try {
      if (!heartbeatService) {
        res.status(503).json({ error: 'Heartbeat service not initialized' });
        return;
      }

      const result = await heartbeatService.runHeartbeat(true);
      res.json(result);
    } catch (error) {
      logger.error({ msg: 'Error running heartbeat', op: 'heartbeat.run', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Heartbeat failed' });
    }
  });

  /**
   * GET /heartbeat/status
   * Get the current heartbeat status and state
   */
  router.get('/heartbeat/status', (_req: Request, res: Response) => {
    try {
      const state = heartbeatService?.getAllState() ?? [];
      const config = heartbeatService?.getConfig();

      res.json({
        enabled: config?.enabled ?? false,
        intervalMs: config?.intervalMs ?? 0,
        workingDirectory: config?.workingDirectory ?? '',
        state: state.map(s => ({
          key: s.key,
          lastChanged: s.last_changed,
          lastProcessed: s.last_processed
        }))
      });
    } catch (error) {
      logger.error({ msg: 'Error getting heartbeat status', op: 'heartbeat.run', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Failed to get heartbeat status' });
    }
  });
}
