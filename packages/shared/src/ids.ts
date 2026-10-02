/**
 * IDs are UUIDv7: a 48-bit millisecond timestamp followed by random bits, so they sort by
 * creation time and can be generated on the device without asking the server. A client that
 * retries a create sends the same id, which is what makes offline creates idempotent.
 */

type RandomSource = (bytes: Uint8Array) => Uint8Array;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function webCryptoRandom(bytes: Uint8Array): Uint8Array {
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: RandomSource } }).crypto;
  if (!webCrypto?.getRandomValues) throw new Error('Web Crypto is not available in this runtime');
  return webCrypto.getRandomValues(bytes);
}

/** A new UUIDv7. `now` and `random` are injectable for tests. */
export function uuidv7(now: number = Date.now(), random: RandomSource = webCryptoRandom): string {
  const bytes = new Uint8Array(16);
  random(bytes);

  // 48-bit big-endian timestamp. Division (not >>) because JS bit operators are 32-bit.
  let timestamp = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }

  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The creation time encoded in a UUIDv7, in milliseconds since the epoch. */
export function uuidv7Timestamp(id: string): number {
  return Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16);
}
