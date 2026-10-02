import { z } from 'zod';

// Zod 4 decides whether to compile validators with `new Function()` when each schema is built.
// Our CSP forbids eval, so opt out of that fast path (our payloads are tiny) instead of weakening
// the policy. This module must be imported before anything that builds schemas, e.g. @budget/shared.
z.config({ jitless: true });
