import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { ConfigService } from '../src/services/ConfigService.js';

// =============================================================================
// ConfigService Unit Tests
// =============================================================================

describe('ConfigService', () => {
  let configDir: string;
  let configPath: string;
  let service: ConfigService;

  beforeEach(() => {
    configDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'config.json');
    service = new ConfigService(configDir);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  describe('getEditableSectionNames', () => {
    it('should return heartbeat as an editable section', () => {
      const names = service.getEditableSectionNames();
      expect(names).toContain('heartbeat');
    });
  });

  describe('getAllEditableSections', () => {
    it('should return empty objects when no config exists', () => {
      const sections = service.getAllEditableSections();
      expect(sections).toHaveProperty('heartbeat');
      expect(sections.heartbeat).toEqual({});
    });

    it('should return heartbeat values from config.json', () => {
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { enabled: true, intervalMs: 120000 },
        apiKeyHash: 'secret-hash',
      }));
      const sections = service.getAllEditableSections();
      expect(sections.heartbeat).toEqual({ enabled: true, intervalMs: 120000 });
      // Should NOT include apiKeyHash
      expect(sections).not.toHaveProperty('apiKeyHash');
    });
  });

  describe('getSection', () => {
    it('should return null for unknown section', () => {
      expect(service.getSection('unknown')).toBeNull();
    });

    it('should return empty object for existing section with no data', () => {
      expect(service.getSection('heartbeat')).toEqual({});
    });

    it('should return section data', () => {
      writeFileSync(configPath, JSON.stringify({
        heartbeat: { enabled: false, maxItems: 5 },
      }));
      expect(service.getSection('heartbeat')).toEqual({ enabled: false, maxItems: 5 });
    });
  });

  describe('updateSection', () => {
    it('should reject unknown section', () => {
      const err = service.updateSection('unknown', { foo: 'bar' });
      expect(err).toBe('Unknown section: unknown');
    });

    it('should reject unknown field', () => {
      const err = service.updateSection('heartbeat', { badField: true });
      expect(err).toBe('Unknown field: badField');
    });

    it('should reject wrong type', () => {
      const err = service.updateSection('heartbeat', { enabled: 'yes' as any });
      expect(err).toBe('Field "enabled" must be of type boolean, got string');
    });

    it('should reject number below min', () => {
      const err = service.updateSection('heartbeat', { intervalMs: 1000 });
      expect(err).toBe('Field "intervalMs" must be >= 60000');
    });

    it('should accept valid data and write to disk', () => {
      const err = service.updateSection('heartbeat', {
        enabled: true,
        intervalMs: 120000,
        workingDirectory: '/tmp/test',
        maxItems: 10,
      });
      expect(err).toBeNull();

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.heartbeat.enabled).toBe(true);
      expect(config.heartbeat.intervalMs).toBe(120000);
      expect(config.heartbeat.workingDirectory).toBe('/tmp/test');
      expect(config.heartbeat.maxItems).toBe(10);
    });

    it('should preserve other keys in config.json (read-modify-write)', () => {
      writeFileSync(configPath, JSON.stringify({
        apiKeyHash: 'abc123',
        apiKeyCreatedAt: '2024-01-01',
        heartbeat: { enabled: false, intervalMs: 3600000 },
      }));

      const err = service.updateSection('heartbeat', { enabled: true });
      expect(err).toBeNull();

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      // apiKeyHash should be preserved
      expect(config.apiKeyHash).toBe('abc123');
      expect(config.apiKeyCreatedAt).toBe('2024-01-01');
      // heartbeat should be merged
      expect(config.heartbeat.enabled).toBe(true);
      expect(config.heartbeat.intervalMs).toBe(3600000);
    });

    it('should create config dir and file if they do not exist', () => {
      const newDir = join(tmpdir(), `config-new-${Date.now()}`);
      const newService = new ConfigService(newDir);
      const err = newService.updateSection('heartbeat', { enabled: true });
      expect(err).toBeNull();
      expect(existsSync(join(newDir, 'config.json'))).toBe(true);
      rmSync(newDir, { recursive: true, force: true });
    });

    it('should allow maxItems of 0 (unlimited)', () => {
      const err = service.updateSection('heartbeat', { maxItems: 0 });
      expect(err).toBeNull();
    });
  });
});

// =============================================================================
// Config API Route Tests (using real ConfigService with test app)
// =============================================================================

describe('Config API Routes', () => {
  let configDir: string;
  let configPath: string;
  let app: Application;
  let testApiKey: string;

  beforeEach(() => {
    configDir = join(tmpdir(), `config-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'config.json');

    // Create API key
    testApiKey = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(testApiKey).digest('hex');
    writeFileSync(configPath, JSON.stringify({
      apiKeyHash: hash,
      apiKeyCreatedAt: new Date().toISOString(),
      heartbeat: { enabled: true, intervalMs: 3600000, workingDirectory: '/test', maxItems: 0 },
    }));

    // Create test app with real ConfigService
    const configService = new ConfigService(configDir);
    let configChangedSection: string | null = null;

    app = express();
    app.use(express.json());

    // Auth middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/admin') return next();

      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (!config.apiKeyHash) return next();

      const apiKey = req.headers['x-api-key'] as string | undefined;
      if (!apiKey) return res.status(401).json({ error: 'Unauthorized' });

      const reqHash = createHash('sha256').update(apiKey).digest('hex');
      if (reqHash !== config.apiKeyHash) return res.status(401).json({ error: 'Unauthorized' });
      next();
    });

    // Admin page
    app.get('/admin', (_req: Request, res: Response) => {
      res.type('html').send('<html><body>Admin</body></html>');
    });

    // Config routes
    app.get('/api/config', (_req: Request, res: Response) => {
      res.json(configService.getAllEditableSections());
    });

    app.get('/api/config/:section', (req: Request, res: Response) => {
      const section = configService.getSection(req.params.section);
      if (section === null) {
        return res.status(404).json({ error: `Unknown section: ${req.params.section}` });
      }
      res.json(section);
    });

    app.put('/api/config/:section', (req: Request, res: Response) => {
      const validationError = configService.updateSection(req.params.section, req.body);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
      configChangedSection = req.params.section;
      res.json({ success: true });
    });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  describe('GET /admin', () => {
    it('should serve the admin page without auth', async () => {
      const res = await request(app).get('/admin');
      expect(res.status).toBe(200);
      expect(res.type).toContain('html');
    });
  });

  describe('GET /api/config', () => {
    it('should require auth', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(401);
    });

    it('should return all editable sections', async () => {
      const res = await request(app)
        .get('/api/config')
        .set('X-API-Key', testApiKey);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('heartbeat');
      expect(res.body.heartbeat.enabled).toBe(true);
      expect(res.body.heartbeat.intervalMs).toBe(3600000);
      // Should not expose sensitive keys
      expect(res.body).not.toHaveProperty('apiKeyHash');
    });
  });

  describe('GET /api/config/:section', () => {
    it('should return a specific section', async () => {
      const res = await request(app)
        .get('/api/config/heartbeat')
        .set('X-API-Key', testApiKey);
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.intervalMs).toBe(3600000);
    });

    it('should return 404 for unknown section', async () => {
      const res = await request(app)
        .get('/api/config/nonexistent')
        .set('X-API-Key', testApiKey);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/config/:section', () => {
    it('should update heartbeat config', async () => {
      const res = await request(app)
        .put('/api/config/heartbeat')
        .set('X-API-Key', testApiKey)
        .send({ enabled: false, intervalMs: 120000 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify persisted to disk
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(config.heartbeat.enabled).toBe(false);
      expect(config.heartbeat.intervalMs).toBe(120000);
      // apiKeyHash preserved
      expect(config.apiKeyHash).toBeDefined();
    });

    it('should reject invalid data', async () => {
      const res = await request(app)
        .put('/api/config/heartbeat')
        .set('X-API-Key', testApiKey)
        .send({ enabled: 'yes' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('must be of type boolean');
    });

    it('should reject unknown section', async () => {
      const res = await request(app)
        .put('/api/config/nonexistent')
        .set('X-API-Key', testApiKey)
        .send({ foo: 'bar' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown section');
    });

    it('should reject interval below minimum', async () => {
      const res = await request(app)
        .put('/api/config/heartbeat')
        .set('X-API-Key', testApiKey)
        .send({ intervalMs: 1000 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('>= 60000');
    });

    it('should require auth', async () => {
      const res = await request(app)
        .put('/api/config/heartbeat')
        .send({ enabled: false });
      expect(res.status).toBe(401);
    });
  });
});
