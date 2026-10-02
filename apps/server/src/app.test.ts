import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { healthResponseSchema } from '@budget/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp();

describe('GET /api/healthz', () => {
  it('reports ok and matches the shared response schema', async () => {
    const res = await app.request('/api/healthz', {}, env);

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.version).toBe('test');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('returns 503 when the database is unavailable', async () => {
    const brokenDb = {
      prepare() {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;

    const res = await app.request('/api/healthz', {}, { ...env, DB: brokenDb });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', db: 'error' });
  });

  it('is served by the real Worker entry point', async () => {
    const res = await SELF.fetch('https://budget.test/api/healthz');
    expect(res.status).toBe(200);
    healthResponseSchema.parse(await res.json());
  });
});

describe('API responses', () => {
  it('are never cacheable and carry security headers', async () => {
    const res = await app.request('/api/healthz', {}, env);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('return a JSON 404 for unknown API routes', async () => {
    const res = await app.request('/api/nope', {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('invalid configuration', () => {
  it('answers a clean 500 instead of throwing from the error handler', async () => {
    // The first middleware throws on this config, before any logger has been set.
    const response = await createApp().request(
      '/api/healthz',
      {},
      { ...env, ENVIRONMENT: 'staging' },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
