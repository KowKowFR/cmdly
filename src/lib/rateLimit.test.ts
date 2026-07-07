// ─── env must be set before any DB-touching import ───────────────────────────
process.env.DATABASE_URL ||=
  "postgresql://cmdly:cmdly@localhost:5432/cmdly";
process.env.BETTER_AUTH_SECRET ||=
  "dev-secret-please-change-0000000000000000";

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

// Dynamic imports — env vars are assigned before these run
const { db } = await import("@/lib/db");
const { users, rateLimits } = await import("@/lib/db/schema");
const { eq, and, like } = await import("drizzle-orm");
const { checkRateLimit } = await import("@/lib/rateLimit");

// ─── Unique test user per run ─────────────────────────────────────────────────

const TEST_USER_ID = `rl-test-${process.pid}`;
const TEST_EMAIL = `rl-test-${process.pid}@test.local`;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(async () => {
  // Insert a test user — rateLimits.userId FK references users.id
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      email: TEST_EMAIL,
      name: "Rate Limit Test User",
      emailVerified: false,
    })
    .onConflictDoNothing();
});

after(async () => {
  // rateLimits rows cascade-delete when user is deleted, but clean up
  // stray rows first just in case (e.g. if FK was relaxed in a migration)
  await db
    .delete(rateLimits)
    .where(like(rateLimits.userId, "rl-test-%"));
  await db.delete(users).where(like(users.id, "rl-test-%"));
});

// ─── Helper: clear rate-limit rows between sub-tests ─────────────────────────

async function clearRateLimits(category: string): Promise<void> {
  await db
    .delete(rateLimits)
    .where(
      and(eq(rateLimits.userId, TEST_USER_ID), eq(rateLimits.action, category))
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("read: always allowed regardless of call count", async () => {
  for (let i = 0; i < 20; i++) {
    const result = await checkRateLimit(TEST_USER_ID, "read");
    assert.equal(result.allowed, true, `read call ${i + 1} should be allowed`);
  }
});

test("modify: 5 calls allowed, 6th denied", async () => {
  await clearRateLimits("modify");

  for (let i = 0; i < 5; i++) {
    const result = await checkRateLimit(TEST_USER_ID, "modify");
    assert.equal(result.allowed, true, `modify call ${i + 1} should be allowed`);
  }

  const sixth = await checkRateLimit(TEST_USER_ID, "modify");
  assert.equal(sixth.allowed, false, "6th modify call should be denied");
  assert.equal(sixth.remaining, 0);
  assert.ok(sixth.resetAt instanceof Date, "resetAt should be a Date");
  assert.ok(sixth.resetAt > new Date(), "resetAt should be in the future");
});

test("destroy: 1st call allowed, 2nd denied", async () => {
  await clearRateLimits("destroy");

  const first = await checkRateLimit(TEST_USER_ID, "destroy");
  assert.equal(first.allowed, true, "1st destroy call should be allowed");
  assert.equal(first.remaining, 0);

  const second = await checkRateLimit(TEST_USER_ID, "destroy");
  assert.equal(second.allowed, false, "2nd destroy call should be denied");
  assert.equal(second.remaining, 0);
});

test("modify: remaining decrements correctly", async () => {
  await clearRateLimits("modify");

  const r1 = await checkRateLimit(TEST_USER_ID, "modify");
  assert.equal(r1.remaining, 4);

  const r2 = await checkRateLimit(TEST_USER_ID, "modify");
  assert.equal(r2.remaining, 3);

  const r3 = await checkRateLimit(TEST_USER_ID, "modify");
  assert.equal(r3.remaining, 2);
});
