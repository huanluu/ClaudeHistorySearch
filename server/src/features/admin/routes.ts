import { type Router, type Request, type Response } from 'express';
import type { Logger } from '../../shared/provider/index';
import type { DiagnosticsService } from './DiagnosticsService';
import type { ConfigService } from './ConfigService';

export interface AdminRouteDeps {
  diagnosticsService?: DiagnosticsService;
  configService?: ConfigService;
  onConfigChanged?: (section: string) => void;
  logger: Logger;
  adminHtml?: string;
}

function handleGetConfigSection(
  configService: ConfigService, req: Request, res: Response, logger: Logger,
): void {
  try {
    const sectionName = req.params.section as string;
    const section = configService.getSection(sectionName);
    if (section === null) {
      res.status(404).json({ error: `Unknown section: ${sectionName}` });
      return;
    }
    res.json(section);
  } catch (error) {
    logger.error({ msg: 'Error reading config section', op: 'server.config', err: error, errType: 'internal_error' });
    res.status(500).json({ error: 'Failed to read config section' });
  }
}

function handlePutConfigSection(
  configService: ConfigService, req: Request, res: Response,
  onConfigChanged: ((section: string) => void) | undefined, logger: Logger,
): void {
  try {
    const sectionName = req.params.section as string;
    const validationError = configService.updateSection(sectionName, req.body);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
    if (onConfigChanged) onConfigChanged(sectionName);
    res.json({ success: true });
  } catch (error) {
    logger.error({ msg: 'Error updating config section', op: 'server.config', err: error, errType: 'internal_error' });
    res.status(500).json({ error: 'Failed to update config section' });
  }
}

export function registerAdminRoutes(router: Router, deps: AdminRouteDeps): void {
  const { diagnosticsService, configService, onConfigChanged, logger, adminHtml } = deps;

  router.get('/health', (_req: Request, res: Response) => {
    if (diagnosticsService) {
      res.json(diagnosticsService.getHealth());
    } else {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    }
  });

  router.get('/diagnostics', (_req: Request, res: Response) => {
    if (!diagnosticsService) {
      res.status(503).json({ error: 'Diagnostics service not initialized' });
      return;
    }
    const diagnostics = diagnosticsService.getDiagnostics();
    res.status(diagnostics.status === 'unhealthy' ? 503 : 200).json(diagnostics);
  });

  router.get('/admin', (_req: Request, res: Response) => {
    if (adminHtml) res.type('html').send(adminHtml);
    else res.status(503).send('Admin UI not available');
  });

  router.get('/api/config', (_req: Request, res: Response) => {
    try {
      if (!configService) { res.status(503).json({ error: 'Config service not initialized' }); return; }
      res.json(configService.getAllEditableSections());
    } catch (error) {
      logger.error({ msg: 'Error reading config', op: 'server.config', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Failed to read config' });
    }
  });

  router.get('/api/config/:section', (req: Request, res: Response) => {
    if (!configService) { res.status(503).json({ error: 'Config service not initialized' }); return; }
    handleGetConfigSection(configService, req, res, logger);
  });

  router.put('/api/config/:section', (req: Request, res: Response) => {
    if (!configService) { res.status(503).json({ error: 'Config service not initialized' }); return; }
    handlePutConfigSection(configService, req, res, onConfigChanged, logger);
  });
}
