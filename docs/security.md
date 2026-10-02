[← Plan overview](PLAN.md)

# Security

- **Auth**: no passwords exist anywhere in the system. Session tokens are hashed at rest. `state` + PKCE on every OAuth round-trip. See [Auth](auth.md) for the sign-up gate.
- **CSRF**: `SameSite=Lax` + `Origin` header check on all non-GET requests.
- **AuthZ**: membership and role checked per request and per mutation, server-side. Never trust a `group_id` from the client.
- **Rate limiting** on auth, `attempt/redeem` and invite endpoints, done at Cloudflare (rate-limiting rules or the Workers rate-limit binding), **not in Worker memory**: isolates are many and short-lived, so an in-memory counter would not hold. Invites are random, expiring, usage-limited, and stored hashed.
- **Input**: zod-validate every inbound payload; Drizzle parameterized queries only.
- **Headers**: strict CSP (`default-src 'self'`, `script-src 'self'`, no inline scripts, no `eval`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, set by Cloudflare from `apps/web/public/_headers` for the app and by Hono's `secureHeaders` for API responses. `style-src` needs `'unsafe-inline'` because shadcn/sonner inject styles. An e2e test (`e2e/security-headers.spec.ts`) loads the app under the policy the Worker **really serves** and fails on any violation. It already caught one issue: zod 4 compiles validators with `new Function()` at schema-construction time, so `apps/web/src/lib/zod-config.ts` (imported first in `main.tsx`) turns that off rather than allowing `unsafe-eval`.
- **Secrets**: Google client secret and any other secrets only as Worker secrets (`wrangler secret put`) or the gitignored `.dev.vars`. Config is validated at startup of each isolate; the build never contains secrets.
- **No host to harden**: no SSH, firewall or OS patching to do. The Worker runs in Cloudflare's sandbox.
- **Dependencies**: Dependabot on; `npm audit --omit=dev` gates CI. The remaining dev-only advisories (miniflare inside the Workers test pool, esbuild inside drizzle-kit) have no non-breaking fix and never ship; revisit when those tools release updates.
