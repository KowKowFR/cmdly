# Task 20 Report — Install Script, Seed, Config Check, E2E Verification

**Date:** 2026-07-07  
**Branch:** build/cmdly  
**Commit:** (see below after commit)

---

## Files Changed

- `scripts/install.sh` — idempotent Debian/Ubuntu installer
- `scripts/seed.ts` — creates default admin user (idempotent)
- `scripts/check-config.ts` — pre-flight configuration checker

---

## 1. `scripts/install.sh`

### Steps implemented
1. **OS check** — reads `/etc/os-release`; exits with clear message if not Debian 12+ or Ubuntu 22+.
2. **Node.js 20** — skips if `node -v` is already >= 20; installs via NodeSource otherwise.
3. **Terraform** — skips if `terraform` present; installs via HashiCorp APT repo.
4. **Ansible** — skips if present; installs via APT.
5. **PostgreSQL 15+** — skips if present; creates `cmdly` DB + `cmdly` role with a generated password saved to `/root/.cmdly_pgpass` (idempotent).
6. **Clone/pull** — `git clone` into `/opt/cmdly`; `git pull --ff-only` if already present. `CMDLY_REPO_URL` variable near top is the placeholder.
7. **npm ci / build** — uses `npm ci` if `package-lock.json` exists.
8. **`.env` generation** — writes `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 48`), `BETTER_AUTH_URL`. Skips if `.env` already exists. Secrets NOT echoed to logs.
9. **DB migrations** — `npx drizzle-kit migrate` after sourcing `.env`.
10. **systemd service** — creates `/etc/systemd/system/cmdly.service` (only if absent); `systemctl enable + restart cmdly`.
11. **Access URL** — prints `http://<host-ip>:3000` + onboarding instructions.

### shellcheck result
```
bash -n scripts/install.sh → OK
shellcheck scripts/install.sh → CLEAN (no warnings, no errors)
```

---

## 2. `scripts/seed.ts`

- Loads `.env` from project root via `dotenv` (no override so real env vars take priority).
- Requires `DATABASE_URL` + `BETTER_AUTH_SECRET`; exits 1 with clear message if missing.
- Checks if any `role = 'admin'` user exists → exits 0 with "already exists" message (idempotent).
- If target email exists as a non-admin → promotes to admin.
- Otherwise creates user row + credential account using `@better-auth/utils/password` (`hashPassword`) — the exact same scrypt implementation better-auth uses internally (salt:hash format).
- Default email: `admin@cmdly.local` (override via `SEED_ADMIN_EMAIL`).
- If no `SEED_ADMIN_PASSWORD`, generates a random password and prints it **once only**.

### Verification
```
Run 1: [seed] ✓ Admin user created successfully.  Email: admin@cmdly.local  Password: <generated> ← SAVE THIS — shown once only
Run 2: [seed] Admin user(s) already exist: admin@cmdly.local. Nothing to do.
```

---

## 3. `scripts/check-config.ts`

- Loads `.env` from project root via `dotenv`.
- Checks `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — exits 1 with English+French message if any missing.
- Runs `SELECT 1` against the DB — exits 1 if unreachable.
- Queries `infrastructure_config.onboarding_completed` — warns if not completed.
- Queries `users WHERE role = 'admin'` — warns if zero admins.
- Exits 0 (all required checks pass regardless of onboarding/admin warnings).

### Verification against local dev DB
```
✓ DATABASE_URL = postgresql://cmdly:***@localhost:5432/cmdly
✓ BETTER_AUTH_SECRET = *** (set)
✓ BETTER_AUTH_URL = http://localhost:3000
✓ Database reachable
⚠ Onboarding not yet completed (expected — no infra configured)
✓ 1 admin user(s) found (after seed run)
All required checks passed.
```

---

## 4. End-to-End Verification

### HTTP-level checks (dev server started on port 3000)

| Check | Result |
|---|---|
| `GET /` unauthenticated | `307 → /login?callbackUrl=%2F` ✓ |
| `GET /api/health` | `200 {"status":"ok"}` ✓ |

### Final build
`npm run build` — **0 TypeScript type errors**. The `getSession failed` log lines during build are expected: Next.js pre-renders dynamic routes at build time and `next/headers` throws in that context; errors are caught and logged, not a build failure.

### Full unit test suite
```
npx tsx --test <22 test files>

ℹ tests     146
ℹ suites      9
ℹ pass      146
ℹ fail        0
ℹ cancelled   0
ℹ skipped     0
ℹ todo        0
ℹ duration_ms ~11 200
```

---

## What Remains Manual (requires live infra/credentials)

1. **Full chat round-trip** — requires a real OpenAI/Anthropic/Ollama API key set in the onboarding wizard. Without it, chat will error on `tool_call` execution. This is the only functional path not testable here.
2. **Proxmox/Zabbix/Wazuh tool execution** — requires live infrastructure. All 14 tools are unit-tested with mocks (all pass), but real API calls need actual endpoints.
3. **Debian/Ubuntu install.sh** — can only be fully run on a target Debian 12 or Ubuntu 22 VM; shellcheck-clean and bash-n-clean here on macOS, but cannot run the full installation flow locally.
4. **LDAP integration** — requires a running LDAP server. LDAP unit tests are in-memory and pass.

---

## Self-Review / Concerns

- **Password in seed output**: The generated password is printed once to stdout. On a CI/CD runner, this could appear in logs. Operators should pipe stdout to a secure location or use `SEED_ADMIN_PASSWORD` env var to avoid generation.
- **install.sh `/root/.cmdly_pgpass`**: The Postgres password is cached in `/root/.cmdly_pgpass` for idempotency. On re-runs this is read back rather than regenerated. This file is chmod 600.
- **`CMDLY_REPO_URL` placeholder**: The install.sh contains a placeholder URL (`https://github.com/PLACEHOLDER/cmdly.git`) that must be replaced before publishing. Comment in the script makes this clear.

---

## Task 20 — Reviewer-Identified Bugs Fixed (commit 7b49fb9)

### C1 — npm ci no longer strips devDependencies
`npm ci --omit=dev` → `npm ci` (same for the `npm install` fallback path). `next build` needs tailwindcss / @tailwindcss/postcss / typescript; `drizzle-kit migrate` needs drizzle-kit. Both are devDependencies.

### C2 — .env written BEFORE build
Step 7 (write .env) and Step 8 (npm ci + build) were swapped. New order: clone → write .env → npm ci → npm run build → migrate → systemd → print URL. `NEXT_PUBLIC_APP_URL` IS referenced in `src/lib/auth/client.ts` so it must be embedded at build time. `.env`-exists guard (never overwrite / never regenerate secret) preserved.

### I1 — PG_PASSWORD no longer exposed in ps output
Replaced `su -c "psql -c \"CREATE ROLE ... PASSWORD '${PG_PASSWORD}'\""` with a temp-file approach: SQL written to a `mktemp` file (chmod 600, chown postgres), then `su - postgres -c "psql -f '<file>'"`. Temp file is removed after. Password never appears as a CLI argument.

### I2 — No hard-restart of a live service on re-run
`systemctl restart cmdly` → conditional: `systemctl is-active --quiet cmdly` → `try-restart` if running, else `start`. Combined with `daemon-reload` + `enable` that run unconditionally.

### M1 — .env mode 600
`chmod 640` → `chmod 600` (owner-only; systemd reads it as root, group read not needed).

### M3 — seed.ts inserts wrapped in transaction
Both `db.insert(schema.users)` and `db.insert(schema.accounts)` are now inside `db.transaction(async (tx) => { ... })` using `tx` for both inserts. Prevents orphan user with no credential account on crash. TypeScript compiles cleanly; idempotent path verified (`npx tsx scripts/seed.ts` → "Admin user(s) already exist. Nothing to do.").

### M5 — Portable version parsing (awk/cut replaces grep -oP)
- PostgreSQL: `psql --version | grep -oP '\d+' | head -1` → `psql --version | awk '{print $3}' | cut -d'.' -f1`
- Terraform log: `terraform version -json | grep -oP '"terraform_version":"\K[^"]+'` → `terraform version | awk 'NR==1{print $2}'`
Both are POSIX-portable; no PCRE dependency.

### shellcheck result
`bash -n scripts/install.sh` → OK  
`shellcheck scripts/install.sh` → CLEAN (0 warnings)

---

## Task 20 (addendum) — tsc --noEmit Typecheck Cleanup (commit 0cb14e6)

**Goal:** Make `npx tsc --noEmit` fully clean across 22 test files (was 28 errors; product code already clean).

### Categories fixed

| Category | Error | Fix applied |
|---|---|---|
| TS2532 (noUncheckedIndexedAccess) | `onboardingSchemas[N]` possibly undefined | Added `!` to all 7 indexed schema accesses in `onboarding.test.ts` |
| TS18046 result.data unknown | Zod `safeParse` result.data is `unknown` when schema typed as base class | Cast `result.data` to specific shape at 3 call sites |
| TS2532 Buffer indexed access | `bad[bad.length - 1]` possibly undefined in `crypto.test.ts` | Extracted to `const lastByte`, narrowed with `assert.ok(lastByte !== undefined)` |
| TS2344 Function constraint | `Parameters<typeof ProxmoxClient.prototype.constructor>` — `Function` doesn't satisfy `(...args: any) => any` | Changed to `ConstructorParameters<typeof ProxmoxClient>[0]` in `proxmox.test.ts` |
| TS2339 property on never | `destroyCalledWith` narrowed to `null` by TS control-flow after closure assignment, making `!` produce `never` | Captured as typed const after `assert.ok` null check in `destroy_vm.test.ts` |

### Files changed
- `src/lib/crypto.test.ts`
- `src/lib/proxmox.test.ts`
- `src/lib/tools/destroy_vm.test.ts`
- `src/lib/validation/onboarding.test.ts`

### Results
- `npx tsc --noEmit` → **0 errors** (exit 0)
- `npx tsx --test <22 test files>` → **146 pass, 0 fail**
- `npm run build` → **clean** (product code untouched)
- No `any`, no `@ts-ignore`, no `@ts-expect-error` added
