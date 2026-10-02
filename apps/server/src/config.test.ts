import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies safe defaults (loopback host, development environment)', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_PATH: './data/app.db',
      APP_VERSION: 'dev',
    });
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'loud'],
  ])('rejects %s=%s with a readable message', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(/Invalid environment configuration/);
  });
});
