import { healthResponseSchema } from '@budget/shared';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './test/helpers';

describe('GET /api/healthz', () => {
  it('reports ok and matches the shared response schema', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/healthz');

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.version).toBe('test');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('returns 503 when the database is unavailable', async () => {
    const { app, sqlite } = createTestApp();
    sqlite.close();

    const res = await app.request('/api/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', db: 'error' });
  });

  it('sets security headers', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/healthz');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const { app } = createTestApp();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
