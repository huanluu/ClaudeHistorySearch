import { type Router, type Request, type Response } from 'express';
import type { Logger } from '../../shared/provider/index';
import type { CronService } from './CronService';

export interface CronRouteDeps {
  cronService: CronService;
  logger: Logger;
}

export function registerCronRoutes(router: Router, deps: CronRouteDeps): void {
  const { cronService, logger } = deps;

  router.get('/cron/jobs', (_req: Request, res: Response) => {
    try {
      res.json(cronService.listJobs());
    } catch (error) {
      logger.error({ msg: 'Error listing cron jobs', op: 'cron.routes', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Failed to list cron jobs' });
    }
  });

  router.get('/cron/jobs/:id', (req: Request, res: Response) => {
    try {
      const job = cronService.getJobStatus(String(req.params.id));
      res.json(job);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        logger.error({ msg: 'Error getting cron job', op: 'cron.routes', err: error, errType: 'internal_error' });
        res.status(500).json({ error: 'Failed to get cron job' });
      }
    }
  });

  router.post('/cron/jobs', (req: Request, res: Response) => {
    try {
      const { name, schedule, prompt, workingDir } = req.body;
      if (!name || !schedule || !prompt || !workingDir) {
        res.status(400).json({ error: 'Missing required fields: name, schedule, prompt, workingDir' });
        return;
      }
      const job = cronService.addJob({ name, schedule, prompt, workingDir });
      res.status(201).json(job);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('Unsupported') || msg.includes('cannot be empty')) {
        res.status(400).json({ error: msg });
      } else {
        logger.error({ msg: 'Error creating cron job', op: 'cron.routes', err: error, errType: 'internal_error' });
        res.status(500).json({ error: 'Failed to create cron job' });
      }
    }
  });

  router.put('/cron/jobs/:id', (req: Request, res: Response) => {
    try {
      const { name, enabled, schedule_kind, schedule_value, prompt, working_dir } = req.body;
      const fields: Record<string, unknown> = {};
      if (name !== undefined) fields.name = name;
      if (enabled !== undefined) fields.enabled = enabled;
      if (schedule_kind !== undefined) fields.schedule_kind = schedule_kind;
      if (schedule_value !== undefined) fields.schedule_value = schedule_value;
      if (prompt !== undefined) fields.prompt = prompt;
      if (working_dir !== undefined) fields.working_dir = working_dir;
      const updated = cronService.updateJob(String(req.params.id), fields);
      res.json(updated);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        logger.error({ msg: 'Error updating cron job', op: 'cron.routes', err: error, errType: 'internal_error' });
        res.status(500).json({ error: 'Failed to update cron job' });
      }
    }
  });

  router.delete('/cron/jobs/:id', (req: Request, res: Response) => {
    try {
      cronService.removeJob(String(req.params.id));
      res.status(204).send();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        logger.error({ msg: 'Error removing cron job', op: 'cron.routes', err: error, errType: 'internal_error' });
        res.status(500).json({ error: 'Failed to remove cron job' });
      }
    }
  });

  router.post('/cron/jobs/:id/run', async (req: Request, res: Response) => {
    try {
      const result = await cronService.runJobNow(String(req.params.id));
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else {
        logger.error({ msg: 'Error running cron job', op: 'cron.routes', err: error, errType: 'internal_error' });
        res.status(500).json({ error: 'Failed to run cron job' });
      }
    }
  });
}
