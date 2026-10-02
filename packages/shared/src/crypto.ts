/**
 * The few Web Crypto helpers both sides need. Sign-in from the installed app only works if the
 * device and the server encode and hash identically (a 43-character URL-safe secret, a lowercase
 * hex SHA-256), so there is exactly one copy of this code, used by the browser and the Worker.
 */

interface WebCrypto {
  getRandomValues(bytes: Uint8Array): Uint8Array;
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
}

function webCrypto(): WebCrypto {
  const web = (globalThis as { crypto?: WebCrypto }).crypto;
  if (!web?.subtle) throw new Error('Web Crypto is not available in this runtime');
  return web;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** URL-safe base64 (RFC 4648 §5) without padding. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    out += ALPHABET[(chunk >> 18) & 63];
    out += ALPHABET[(chunk >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(chunk >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[chunk & 63];
  }
  return out;
}

/** A random token from the system's secure generator: 32 bytes (the default) make 43 characters. */
export function randomToken(byteLength = 32): string {
  return base64url(webCrypto().getRandomValues(new Uint8Array(byteLength)));
}

/** SHA-256 of a string as lowercase hex. Only hashes of tokens are ever stored or sent on. */
export async function sha256Hex(text: string): Promise<string> {
  const Encoder = (
    globalThis as unknown as { TextEncoder: new () => { encode(s: string): Uint8Array } }
  ).TextEncoder;
  const digest = await webCrypto().subtle.digest('SHA-256', new Encoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
