import { test } from "node:test";
import assert from "node:assert/strict";
process.env.BETTER_AUTH_SECRET = "test-secret-please-change-0000000000";
const { encrypt, decrypt } = await import("./crypto.ts");

test("round-trips a secret", () => {
  const c = encrypt("hunter2");
  assert.notEqual(c, "hunter2");
  assert.equal(decrypt(c), "hunter2");
});
test("two encryptions differ (random IV)", () => {
  assert.notEqual(encrypt("x"), encrypt("x"));
});
test("tampered ciphertext throws", () => {
  const c = encrypt("secret");
  const bad = Buffer.from(c, "base64"); bad[bad.length - 1] ^= 0xff;
  assert.throws(() => decrypt(bad.toString("base64")));
});
