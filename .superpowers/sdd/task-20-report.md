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
- **`CMDLY_REPO_URL` placeholder**: The install.sh contains a placeholder URL (`https://github.com/PLACEHOLDER/cmdly.git`) that must be replaced before publishing.
- **systemd unit re-start**: The installer does `systemctl restart cmdly` even on re-run (service was already enabled). An improvement would be `systemctl reload-or-restart` or checking if config changed.
- **`npm ci --omit=dev`** in install.sh: production installs omit devDependencies. If `drizzle-kit` or `tsx` are needed post-install (for migrations), they should move to `dependencies`. Currently `drizzle-kit` is in devDependencies — migrations in install.sh use `npx drizzle-kit` which downloads it if missing. Fine for install, but worth noting.
