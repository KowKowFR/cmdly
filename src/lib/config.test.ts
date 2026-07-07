// Set env vars BEFORE any imports that might use them
process.env.BETTER_AUTH_SECRET ||= "dev-secret-please-change-0000000000000000";
process.env.DATABASE_URL ||= "postgresql://cmdly:cmdly@localhost:5432/cmdly";

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import ensures env is set before config module loads
const { saveConfig, getConfig } = await import("./config.js");
const { db } = await import("./db/index.js");
const { infrastructureConfig } = await import("./db/schema.js");
const { eq } = await import("drizzle-orm");

test("saveConfig encrypts secrets in the database", async () => {
  await saveConfig({ openaiApiKey: "sk-test-123" });

  const rows = await db
    .select()
    .from(infrastructureConfig)
    .where(eq(infrastructureConfig.id, 1));

  assert.ok(rows.length === 1, "expected exactly one row");
  const row = rows[0]!;
  assert.notEqual(
    row.openaiApiKeyEncrypted,
    "sk-test-123",
    "openaiApiKeyEncrypted should not be the plaintext"
  );
  assert.ok(
    typeof row.openaiApiKeyEncrypted === "string" &&
      row.openaiApiKeyEncrypted.length > 0,
    "openaiApiKeyEncrypted should be non-empty ciphertext"
  );
});

test("getConfig decrypts secrets correctly (round-trip)", async () => {
  const config = await getConfig();
  assert.equal(
    config.openaiApiKey,
    "sk-test-123",
    "decrypted openaiApiKey should equal original plaintext"
  );
});

// Reset so later tasks start clean
await saveConfig({ onboardingCompleted: false });
