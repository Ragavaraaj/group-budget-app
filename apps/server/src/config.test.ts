import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults to production so a deployed Worker is safe unless told otherwise', () => {
    expect(loadConfig({})).toEqual({
      ENVIRONMENT: 'production',
      LOG_LEVEL: 'info',
      APP_VERSION: 'dev',
    });
  });

  it('ignores bindings that are not configuration', () => {
    const config = loadConfig({ DB: { prepare: () => {} }, ASSETS: {}, APP_VERSION: '1.2.3' });
    expect(config.APP_VERSION).toBe('1.2.3');
    expect(config).not.toHaveProperty('DB');
  });

  it('accepts explicit environments', () => {
    expect(loadConfig({ ENVIRONMENT: 'development', LOG_LEVEL: 'debug' })).toMatchObject({
      ENVIRONMENT: 'development',
      LOG_LEVEL: 'debug',
    });
  });

  it.each([
    ['ENVIRONMENT', 'staging'],
    ['LOG_LEVEL', 'loud'],
    ['APP_VERSION', ''],
  ])('rejects %s=%j with a readable message', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(/Invalid Worker configuration/);
  });
});
