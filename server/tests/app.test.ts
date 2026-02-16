import { createApp, type App } from '../src/app.js';
import http from 'http';

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

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  it('should start, respond to /health, and stop', async () => {
    app = createApp({ port: 0 });
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
    app = createApp({ port: 0 });
    await app.start();

    await app.stop();
    // Second stop should not throw
    await app.stop();
  });
});
