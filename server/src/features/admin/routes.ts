import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { type Router, type Request, type Response } from 'express';
import type { Logger } from '../../shared/provider/index';
import type { DiagnosticsService } from './DiagnosticsService';
import type { ConfigService } from './ConfigService';

let adminHtml: string | null = null;
function getAdminHtml(): string {
  if (!adminHtml) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    adminHtml = readFileSync(join(__dirname, 'admin.html'), 'utf-8');
  }
  return adminHtml;
}

export interface AdminRouteDeps {
  diagnosticsService?: DiagnosticsService;
  configService?: ConfigService;
  onConfigChanged?: (section: string) => void;
  logger: Logger;
}

export function registerAdminRoutes(router: Router, deps: AdminRouteDeps): void {
  const { diagnosticsService, configService, onConfigChanged, logger } = deps;

  /**
   * GET /health
   */
  router.get('/health', (_req: Request, res: Response) => {
    if (diagnosticsService) {
      const health = diagnosticsService.getHealth();
      res.json(health);
    } else {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /diagnostics
   */
  router.get('/diagnostics', (_req: Request, res: Response) => {
    if (!diagnosticsService) {
      res.status(503).json({ error: 'Diagnostics service not initialized' });
      return;
    }
    const diagnostics = diagnosticsService.getDiagnostics();
    const statusCode = diagnostics.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(diagnostics);
  });

  /**
   * GET /admin
   */
  router.get('/admin', (_req: Request, res: Response) => {
    res.type('html').send(getAdminHtml());
  });

  /**
   * GET /api/config
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }
      res.json(configService.getAllEditableSections());
    } catch (error) {
      logger.error({ msg: 'Error reading config', op: 'server.config', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Failed to read config' });
    }
  });

  /**
   * GET /api/config/:section
   */
  router.get('/api/config/:section', (req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }
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
  });

  /**
   * PUT /api/config/:section
   */
  router.put('/api/config/:section', (req: Request, res: Response) => {
    try {
      if (!configService) {
        res.status(503).json({ error: 'Config service not initialized' });
        return;
      }

      const sectionName = req.params.section as string;
      const validationError = configService.updateSection(sectionName, req.body);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      if (onConfigChanged) {
        onConfigChanged(sectionName);
      }

      res.json({ success: true });
    } catch (error) {
      logger.error({ msg: 'Error updating config section', op: 'server.config', err: error, errType: 'internal_error' });
      res.status(500).json({ error: 'Failed to update config section' });
    }
  });
}
