import { describe, it, expect } from 'vitest';
import express from 'express';
import { Router } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validateQuery, validateBody } from './validation';

describe('validateQuery middleware', () => {
  const schema = z.object({
    q: z.string().min(1),
    limit: z.coerce.number().int().min(0).optional().default(10),
  });

  function createApp() {
    const app = express();
    const router = Router();
    router.get('/test', validateQuery(schema), (_req, res) => {
      res.json({ validated: res.locals.validated.query });
    });
    app.use(router);
    return app;
  }

  it('passes valid query params to handler', async () => {
    const res = await request(createApp()).get('/test?q=hello&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({ q: 'hello', limit: 5 });
  });

  it('applies defaults for missing optional params', async () => {
    const res = await request(createApp()).get('/test?q=hello');
    expect(res.status).toBe(200);
    expect(res.body.validated.limit).toBe(10);
  });

  it('returns 400 for missing required params', async () => {
    const res = await request(createApp()).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
    expect(res.body.error).toContain('q');
  });

  it('returns 400 for invalid param types', async () => {
    const res = await request(createApp()).get('/test?q=hello&limit=-5');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
  });
});

describe('validateBody middleware', () => {
  const schema = z.object({
    name: z.string(),
    value: z.number(),
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    const router = Router();
    router.put('/test', validateBody(schema), (_req, res) => {
      res.json({ validated: res.locals.validated.body });
    });
    app.use(router);
    return app;
  }

  it('passes valid body to handler', async () => {
    const res = await request(createApp())
      .put('/test')
      .send({ name: 'foo', value: 42 });
    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({ name: 'foo', value: 42 });
  });

  it('returns 400 for missing required fields', async () => {
    const res = await request(createApp())
      .put('/test')
      .send({ name: 'foo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('value');
  });

  it('returns 400 for wrong types', async () => {
    const res = await request(createApp())
      .put('/test')
      .send({ name: 'foo', value: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Validation error');
  });
});
