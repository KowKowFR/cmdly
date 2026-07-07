/**
 * Integration test: hand-signed LDAP session cookie validates via getSession.
 *
 * This test proves that the cookie produced by the LDAP route is accepted by
 * better-auth's `getSession()`.  It guards against future better-auth or
 * better-call version changes that silently alter the signed-cookie format.
 *
 * Approach
 * --------
 * We replicate the exact sequence the LDAP route executes:
 *   1. Insert a test user in the `users` table (same as find-or-create in route).
 *   2. Call `(await auth.$context).internalAdapter.createSession(userId)`.
 *   3. Sign the session token with `signCookieValue(token, ctx.secret)`.
 *   4. Build the `Cookie` header: `${cookieName}=${signedValue}`.
 *   5. Call `auth.api.getSession({ headers })` and assert the returned session
 *      belongs to our test user.
 *
 * Placed in src/lib/auth/ (not src/app/) so tsx runs it as ESM, which supports
 * the top-level await pattern used for env-before-import ordering.
 *
 * Prerequisites
 * -------------
 * - DATABASE_URL pointing to a running PostgreSQL instance with the CMDLY
 *   schema migrated.
 * - BETTER_AUTH_SECRET set (the test provides a fallback for local runs).
 *
 * The test is skipped gracefully when the database is unreachable (ECONNREFUSED),
 * so it does not break CI runs without Postgres.
 */

// ─── env must be set before any DB / auth import ─────────────────────────────
process.env.DATABASE_URL ||= "postgresql://cmdly:cmdly@localhost:5432/cmdly";
process.env.BETTER_AUTH_SECRET ||= "dev-secret-please-change-0000000000000000";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

// Dynamic imports — env vars are assigned before these run
const { auth } = await import("@/lib/auth/config");
const { db } = await import("@/lib/db");
const { users, sessions } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");
const { signCookieValue } = await import("@/lib/auth/sessionCookie");

// ─── Test state ───────────────────────────────────────────────────────────────

const TEST_EMAIL = `ldap-session-test-${process.pid}@ldap.local`;
let testUserId = "";
let testSessionToken = "";
let dbReachable = true;

// ─── Setup ────────────────────────────────────────────────────────────────────

before(async () => {
  // Probe database connectivity. If Postgres is not running, mark the flag so
  // the test body can skip without erroring on "connection refused".
  try {
    testUserId = randomUUID();
    await db
      .insert(users)
      .values({
        id: testUserId,
        email: TEST_EMAIL,
        name: "LDAP Session Test",
        emailVerified: true,
        role: "viewer",
      })
      .onConflictDoNothing();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
      dbReachable = false;
    } else {
      throw err; // unexpected error — let it bubble
    }
  }
});

// ─── Teardown ─────────────────────────────────────────────────────────────────

after(async () => {
  if (!dbReachable) return;
  try {
    // Delete test session rows first (FK constraint)
    if (testSessionToken) {
      await db.delete(sessions).where(eq(sessions.token, testSessionToken));
    }
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
  } catch {
    // Best-effort cleanup — do not fail the test run on teardown errors
  }
});

// ─── Test ─────────────────────────────────────────────────────────────────────

test("hand-signed LDAP session cookie is accepted by auth.api.getSession", async (t) => {
  if (!dbReachable) {
    t.diagnostic("Skipping: database not reachable (ECONNREFUSED)");
    return;
  }

  // Step 1 — access the auth context (same internal API the route uses)
  const ctx = await auth.$context;

  // Step 2 — create a real session row for the test user
  const session = await ctx.internalAdapter.createSession(testUserId);
  assert.ok(session, "internalAdapter.createSession should return a session object");
  assert.ok(
    typeof session.token === "string" && session.token.length > 0,
    "session.token must be a non-empty string",
  );
  testSessionToken = session.token;

  // Step 3 — sign the token exactly as the LDAP route does
  const secret: string = ctx.secret;
  const cookieName: string = ctx.authCookies.sessionToken.name;
  const signedValue = signCookieValue(session.token, secret);

  // Step 4 — build the Cookie header
  const cookieHeader = `${cookieName}=${signedValue}`;

  // Step 5 — call getSession and assert it resolves to our test user
  const result = await auth.api.getSession({
    headers: new Headers({ cookie: cookieHeader }),
  });

  assert.ok(
    result !== null,
    "getSession should return a non-null result for a valid signed cookie",
  );
  assert.equal(
    result?.user.id,
    testUserId,
    `getSession should return the session for user ${testUserId}, got ${result?.user.id}`,
  );
  assert.equal(
    result?.session.token,
    session.token,
    "getSession should return the matching session token",
  );
});
