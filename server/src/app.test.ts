import { createApp, type App } from './app';
import http from 'http';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Helper: make a GET request and return { statusCode, body }.
 */
function httpGet(url: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
    }).on('error', reject);
  });
}

describe('createApp integration', () => {
  let app: App;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `app-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

  });

  afterEach(async () => {
    if (app) await app.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start, respond to /health, and stop', async () => {
    app = createApp({
      port: 0,
      dbPath: join(tmpDir, 'test.db'),
      logPath: join(tmpDir, 'test.log'),

      skipBonjour: true,
      sessionSources: [],
    });
    await app.start();

    const port = app.getPort();
    expect(port).toBeGreaterThan(0);

    const { statusCode, body } = await httpGet(`http://127.0.0.1:${port}/health`);
    expect(statusCode).toBe(200);

    const parsed = JSON.parse(body);
    expect(parsed.status).toBe('healthy');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should handle idempotent stop (calling stop twice)', async () => {
    app = createApp({
      port: 0,
      dbPath: join(tmpDir, 'test.db'),
      logPath: join(tmpDir, 'test.log'),

      skipBonjour: true,
      sessionSources: [],
    });
    await app.start();
    await app.stop();
    // Second stop should not throw
    await app.stop();
  });
});
