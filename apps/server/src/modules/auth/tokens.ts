import { randomToken, sha256Hex } from '@budget/shared';

// The encoding and hashing live in @budget/shared so the browser and the Worker can never drift.
export { randomToken, sha256Hex };

const encoder = new TextEncoder();

/** Compares two strings without leaking where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
