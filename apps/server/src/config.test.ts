import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults to production so a deployed Worker is safe unless told otherwise', () => {
    expect(loadConfig({})).toEqual({
      ENVIRONMENT: 'production',
      LOG_LEVEL: 'info',
      APP_VERSION: 'dev',
      isProduction: true,
      google: null,
      allowedEmails: [],
      devLogin: false,
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
      isProduction: false,
    });
  });

  it.each([
    ['ENVIRONMENT', 'staging'],
    ['LOG_LEVEL', 'loud'],
    ['APP_VERSION', ''],
  ])('rejects %s=%j with a readable message', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(/Invalid Worker configuration/);
  });

  describe('Google sign-in', () => {
    it('is available only when both the client id and secret are set', () => {
      expect(loadConfig({ GOOGLE_CLIENT_ID: 'id' }).google).toBeNull();
      expect(loadConfig({ GOOGLE_CLIENT_SECRET: 'secret' }).google).toBeNull();
      expect(loadConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).google).toEqual(
        {
          clientId: 'id',
          clientSecret: 'secret',
        },
      );
    });

    it('treats blank values as unset', () => {
      expect(loadConfig({ GOOGLE_CLIENT_ID: '  ', GOOGLE_CLIENT_SECRET: '' }).google).toBeNull();
    });
  });

  describe('ALLOWED_EMAILS', () => {
    it('splits on commas and whitespace, lowercases and drops blanks', () => {
      const config = loadConfig({
        ALLOWED_EMAILS: ' Me@Example.com, you@example.com;\n  third@x.in ,, ',
      });
      expect(config.allowedEmails).toEqual(['me@example.com', 'you@example.com', 'third@x.in']);
    });
  });

  describe('dev login', () => {
    it('needs a non-production environment and the explicit flag', () => {
      expect(loadConfig({ ENVIRONMENT: 'development', ENABLE_DEV_LOGIN: '1' }).devLogin).toBe(true);
      expect(loadConfig({ ENVIRONMENT: 'test', ENABLE_DEV_LOGIN: '1' }).devLogin).toBe(true);
      expect(loadConfig({ ENVIRONMENT: 'development' }).devLogin).toBe(false);
      expect(loadConfig({ ENVIRONMENT: 'development', ENABLE_DEV_LOGIN: '0' }).devLogin).toBe(
        false,
      );
    });

    it('can never be on in production, even by mistake', () => {
      expect(loadConfig({ ENVIRONMENT: 'production', ENABLE_DEV_LOGIN: '1' }).devLogin).toBe(false);
      expect(loadConfig({ ENABLE_DEV_LOGIN: '1' }).devLogin).toBe(false); // ENVIRONMENT defaults to production
    });
  });
});
