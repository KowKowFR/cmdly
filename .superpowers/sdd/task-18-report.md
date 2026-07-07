# Task 18 — Optional LDAP Authentication: Implementation Report

## Files Changed

| File | Change |
|------|--------|
| `src/lib/auth/ldap.ts` | **New** — `escapeLdapFilter`, `LdapClientLike`, `LdapResult`, `ldapBind` |
| `src/lib/auth/ldap.test.ts` | **New** — 7 TDD tests with fake client injection |
| `src/app/api/auth/ldap/route.ts` | **New** — `POST /api/auth/ldap` route handler |
| `src/app/(auth)/login/page.tsx` | **Updated** — reads `ldapEnabled` from config; `force-dynamic` |
| `src/components/auth/LoginForm.tsx` | **Updated** — `ldapEnabled` prop; LDAP fetch path; French labels |
| `package.json` / `package-lock.json` | `ldapts` added |

---

## LDAP Bind Flow (`src/lib/auth/ldap.ts`)

1. **Service account bind** — connects to `cfg.ldapUrl` and binds as `ldapBindDn` / `ldapBindPassword`.
2. **User search** — searches `ldapBaseDn` with filter `(|(uid=<esc>)(mail=<esc>))`. Username is escaped per RFC 4515 before embedding in the filter.
3. **User bind** — attempts a second bind as the found DN with the supplied `password`. Success → `{ ok: true, dn }`. Any failure → `{ ok: false, error }`.
4. **finally** — `client.unbind()` is always called; errors are swallowed. The function never throws.

A narrow `LdapClientLike` interface (`bind`, `search`, `unbind`) allows fake clients to be injected via `deps.createClient` — the real `ldapts` Client is loaded via `require("ldapts")` inside `defaultCreateClient` so unit tests never touch it.

---

## Filter-Injection Escaping

`escapeLdapFilter(value: string): string` implements RFC 4515 §3 escaping:

| Character | Encoded |
|-----------|---------|
| `\` (backslash) | `\5c` |
| `(` | `\28` |
| `)` | `\29` |
| `*` | `\2a` |
| NUL (0x00) | `\00` |

A malicious username like `*)(uid=*)` becomes `\2a\29\28uid=\2a\29`, which is safe to embed in an LDAP filter. Test (d) asserts this directly.

---

## How a better-auth Session Is Issued for LDAP Users

After find-or-create, the route does:

```ts
const ctx = await auth.$context; // Promise<AuthContext> exposed by better-auth's base.ts
const session = await ctx.internalAdapter.createSession(userId); // inserts session row in DB
```

`createSession` returns a `Session` object with a `token` (random 32-char string). The token must be **signed** before writing as a cookie — better-auth uses `better-call`'s HMAC-SHA256 scheme:

```
cookie value = encodeURIComponent(`${token}.${base64(HMAC-SHA256(token, secret))}`)
```

The route replicates this using Node's built-in `crypto.createHmac('sha256', ctx.secret)` and sets the resulting value as the `better-auth.session_token` cookie (name comes from `ctx.authCookies.sessionToken.name`; attributes from `ctx.authCookies.sessionToken.attributes`).

This means `auth.api.getSession()` in server components reads the same cookie and resolves the session normally — no changes to the core better-auth setup were needed.

---

## Find-or-Create User Logic

- **Email derivation**: if `username` contains `@`, it's used as-is; otherwise a synthetic `${username}@ldap.local` is used to satisfy the `UNIQUE` constraint.
- **Insert**: `id = randomUUID()`, `email`, `name = username.split("@")[0]`, `role = "viewer"`, `emailVerified = true`, `passwordHash = null` (LDAP users have no local password).
- **Idempotent**: if the row already exists (repeat login), the existing `id` is used.

---

## TDD Evidence

Tests in `src/lib/auth/ldap.test.ts` — all run with a fake client (no real LDAP server):

```
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

Tests cover:
- (a) Happy path → `{ ok: true, dn }`
- (b) Wrong user password → `{ ok: false }`
- (c) User not found in search → `{ ok: false }`
- (d) Injection username `*)(uid=*)` is escaped in the filter
- `escapeLdapFilter`: special chars, normal chars, full payload

---

## Self-Review & Concerns

### Strengths
- Zero `any` / `@ts-ignore` / `console.log` — all linted clean.
- `npm run build` passes with 0 type errors and `/api/auth/ldap` shows as `ƒ` (dynamic).
- LDAP injection prevention is tested explicitly.
- `ldapBind` never throws; sessions and DB calls are isolated cleanly.

### Concerns / Limitations

1. **Internal better-auth API surface**: `auth.$context`, `internalAdapter.createSession`, `authCookies`, and `secret` are not part of better-auth's documented public API. If better-auth changes its internal structure in a future release, the session-issuance path will break silently. The safe mitigation is to pin the `better-auth` version and add a regression test.

2. **Cookie signing replication**: The HMAC-SHA256 signing in `signCookieValue` (in route.ts) mirrors better-call's internal algorithm. This is correct as of better-call's current dist, but could drift. A future-proof approach would be to expose a `createSignedSessionCookie` helper in better-auth itself.

3. **`@ldap.local` synthetic emails**: Users authenticating with a plain username (no `@`) get `username@ldap.local` as their email. This is stored in the DB and works, but may look surprising in the UI. A DN-attribute lookup (e.g. `mail` from the LDAP entry) would be cleaner but requires storing the entry attributes across the bind flow.

4. **No CSRF protection on `/api/auth/ldap`**: The route accepts any JSON POST. better-auth's own endpoints use an origin-check middleware. Adding an `Origin` header check or a CSRF token is advisable before production use.

5. **Rate limiting**: The route is not rate-limited. The existing better-auth rate limiter only covers `better-auth/api` routes. A separate rate limit (e.g. via Next.js middleware) should be added.

---

## Hardening Additions (Task-18 follow-up, commit 69eb9a6)

### Fix 1 — IP-based rate limiting / lockout

**Design**: `src/lib/auth/ldapRateLimit.ts` exports three pure functions over a module-level `Map<string, { fails: number; windowStart: number }>`:

- `recordAndCheck(ip)` — called **before** the LDAP bind. If the IP has ≥ 5 failures within the current 900-second window, returns `{ blocked: true, retryAfterSec }` and the route returns 429 immediately (LDAP is never touched).
- `recordFailure(ip)` — called after a failed bind; increments the counter (or starts a fresh window if the previous one expired).
- `recordSuccess(ip)` — called after a successful bind; clears the entry so the user is not penalised for prior failures.

The route derives the client IP from `x-forwarded-for` (first hop), falling back to `x-real-ip`, then `"unknown"`. The 429 response includes a `Retry-After` header and the French message `"Trop de tentatives. Réessayez plus tard."`. Blocked attempts are logged via `logger.warn` (IP only — never the password).

**Single-instance note**: The in-memory Map is consistent with the app's other in-memory stores. State is lost on process restart and not shared across replicas. For multi-instance production deployments, replace with a Redis-backed counter.

**Tests** (`src/lib/auth/ldapRateLimit.test.ts`, 7 tests, all pass):
- Fresh IP → not blocked.
- 5 failures → blocked on next `recordAndCheck`; `retryAfterSec` is ≤ 900.
- 4 failures → not blocked.
- `recordSuccess` clears the block.
- Window-reset path verified via public API.
- Two IPs tracked independently.

### Fix 2 — Origin check (CSRF guard)

**Design choice**: Reject only when the `Origin` header is **present** and does **not** match `process.env.BETTER_AUTH_URL`. Absent-Origin requests are allowed because same-origin Next.js server-component fetches, `curl`, and test helpers may legitimately omit `Origin`. Rejecting absent-Origin would break those callers while offering minimal additional security beyond mismatched-Origin rejection.

If `BETTER_AUTH_URL` is not set, the check is skipped (the route was already misconfigured). Response: `403 { ok: false, error: "Origine non autorisée" }`.

### Fix 3 — Session-cookie validation test

**Approach taken: real `getSession` integration test** (`src/lib/auth/session.test.ts`).

The test:
1. Inserts a temporary test user via Drizzle.
2. Calls `(await auth.$context).internalAdapter.createSession(userId)`.
3. Signs the token with the same `signCookieValue` the route uses.
4. Calls `auth.api.getSession({ headers: new Headers({ cookie: ... }) })`.
5. Asserts `result.user.id === testUserId` and `result.session.token === session.token`.
6. Cleans up both the session row and the user row in `after()`.

The test is placed in `src/lib/auth/` (not `src/app/api/`) so that tsx runs it as ESM (the `src/app/` directory is treated as CJS by Next.js/esbuild, which blocks top-level await). It is skipped gracefully when Postgres is unreachable (ECONNREFUSED) so it does not block local runs without a DB.

**Result**: Test passed against the live local DB — the signed cookie is accepted by `auth.api.getSession`, confirming the signing scheme is correct.

The `signCookieValue` function was extracted from route.ts into `src/lib/auth/sessionCookie.ts` (also exports `verifyCookieValue` for round-trip unit tests). Five round-trip unit tests in `ldap.test.ts` cover sign/verify correctness, tampered-signature detection, and wrong-secret rejection.

**Injection test (d) tightened**: Added `assert.ok(!capturedFilter.includes("uid=*"), ...)` to catch partial-escape regressions where the leading `*` is escaped but the interior `uid=*` segment leaks through.

### Version-pinning recommendation

Both `better-auth` and `better-call` should be pinned to exact versions in `package.json` (e.g. `"better-auth": "1.6.23"`) to prevent a silent signing-scheme change after `npm update`. The `session.test.ts` integration test will fail loudly if the scheme drifts, but pinning avoids the failure in the first place.
