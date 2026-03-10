import { type Router, type Request, type Response } from 'express';
import type { Logger } from '../../shared/provider/index';
import type { CronService } from './CronService';

export interface CronRouteDeps {
  cronService: CronService;
  logger: Logger;
}

function handleCronError(
  error: unknown, res: Response, logger: Logger, op: string, fallbackMsg: string,
): void {
  const msg = error instanceof Error ? error.message : '';
  if (msg.includes('not found')) {
    res.status(404).json({ error: msg });
  } else if (msg.includes('Unsupported') || msg.includes('cannot be empty')) {
    res.status(400).json({ error: msg });
  } else {
    logger.error({ msg: `Error ${op}`, op: 'cron.routes', err: error, errType: 'internal_error' });
    res.status(500).json({ error: fallbackMsg });
  }
}

function extractUpdateFields(body: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const keys = ['name', 'enabled', 'schedule_kind', 'schedule_value', 'schedule_timezone', 'prompt', 'working_dir'];
  for (const key of keys) {
    if (body[key] !== undefined) fields[key] = body[key];
  }
  return fields;
}

export function registerCronRoutes(router: Router, deps: CronRouteDeps): void {
  const { cronService, logger } = deps;

  router.get('/cron/jobs', (_req: Request, res: Response) => {
    try { res.json(cronService.listJobs()); }
    catch (error) { handleCronError(error, res, logger, 'listing cron jobs', 'Failed to list cron jobs'); }
  });

  router.get('/cron/jobs/:id', (req: Request, res: Response) => {
    try { res.json(cronService.getJobStatus(String(req.params.id))); }
    catch (error) { handleCronError(error, res, logger, 'getting cron job', 'Failed to get cron job'); }
  });

  router.post('/cron/jobs', (req: Request, res: Response) => {
    try {
      const { name, schedule, prompt, workingDir } = req.body;
      if (!name || !schedule || !prompt || !workingDir) {
        res.status(400).json({ error: 'Missing required fields: name, schedule, prompt, workingDir' });
        return;
      }
      res.status(201).json(cronService.addJob({ name, schedule, prompt, workingDir }));
    } catch (error) { handleCronError(error, res, logger, 'creating cron job', 'Failed to create cron job'); }
  });

  router.put('/cron/jobs/:id', (req: Request, res: Response) => {
    try { res.json(cronService.updateJob(String(req.params.id), extractUpdateFields(req.body))); }
    catch (error) { handleCronError(error, res, logger, 'updating cron job', 'Failed to update cron job'); }
  });

  router.delete('/cron/jobs/:id', (req: Request, res: Response) => {
    try { cronService.removeJob(String(req.params.id)); res.status(204).send(); }
    catch (error) { handleCronError(error, res, logger, 'removing cron job', 'Failed to remove cron job'); }
  });

  router.post('/cron/jobs/:id/run', async (req: Request, res: Response) => {
    try { res.json(await cronService.runJobNow(String(req.params.id))); }
    catch (error) { handleCronError(error, res, logger, 'running cron job', 'Failed to run cron job'); }
  });
}
