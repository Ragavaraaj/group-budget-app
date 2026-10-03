import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { base64url, randomToken, sha256Hex } from '../src/crypto';
import { attemptHashSchema, attemptSecretSchema } from '../src/schemas/api';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (s: string) => bytes(...Array.from(s, (ch) => ch.charCodeAt(0)));

describe('base64url', () => {
  it.each([
    ['', ''],
    ['f', 'Zg'],
    ['fo', 'Zm8'],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg'],
    ['fooba', 'Zm9vYmE'],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j (RFC 4648 vectors, no padding)', (input, expected) => {
    expect(base64url(text(input))).toBe(expected);
  });

  it('uses the URL-safe alphabet', () => {
    expect(base64url(bytes(0xfb, 0xff))).toBe('-_8'); // standard base64 would give "+/8="
  });

  it('property: output only has URL-safe characters and the expected length', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (data) => {
        const out = base64url(data);
        return /^[A-Za-z0-9_-]*$/.test(out) && out.length === Math.ceil((data.length * 4) / 3);
      }),
    );
  });
});

describe('randomToken', () => {
  it('is 43 URL-safe characters for 32 bytes, and different every time', () => {
    const tokens = Array.from({ length: 50 }, () => randomToken());
    expect(new Set(tokens).size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('is exactly what the installed app sends as its attempt secret', () => {
    // The server and the browser must agree on this shape; the shared schema is the contract.
    for (let i = 0; i < 20; i++)
      expect(attemptSecretSchema.safeParse(randomToken()).success).toBe(true);
  });
});

describe('sha256Hex', () => {
  it('matches the published vectors', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is the attempt hash the server expects', async () => {
    expect(attemptHashSchema.safeParse(await sha256Hex(randomToken())).success).toBe(true);
  });

  it('handles non-ASCII text', async () => {
    expect(await sha256Hex('₹100')).toMatch(/^[0-9a-f]{64}$/);
  });
});
