/**
 * scripts/seed.ts — create a default admin user if none exists (idempotent).
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *   SEED_ADMIN_EMAIL=me@example.com SEED_ADMIN_PASSWORD=secret npx tsx scripts/seed.ts
 *
 * The script loads .env from the project root automatically.
 */

import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

// Also try loading from project root .env in case cwd differs
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env"), override: false });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema.js";

// ─── Env validation ───────────────────────────────────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"];
const BETTER_AUTH_SECRET = process.env["BETTER_AUTH_SECRET"];

if (!DATABASE_URL) {
  console.error("[seed] ERROR: DATABASE_URL is not set. Check your .env file.");
  process.exit(1);
}
if (!BETTER_AUTH_SECRET) {
  console.error(
    "[seed] ERROR: BETTER_AUTH_SECRET is not set. Check your .env file."
  );
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ADMIN_EMAIL =
  process.env["SEED_ADMIN_EMAIL"] ?? "admin@cmdly.local";
const ADMIN_NAME = process.env["SEED_ADMIN_NAME"] ?? "CMDLY Admin";

// If a password is not provided, generate a random one and print it once.
let ADMIN_PASSWORD = process.env["SEED_ADMIN_PASSWORD"] ?? "";
let generatedPassword = false;
if (!ADMIN_PASSWORD) {
  // crypto.randomUUID gives 36 chars; combine two for a strong password
  ADMIN_PASSWORD = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  generatedPassword = true;
}

// ─── DB setup ────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── Password hashing (matches better-auth's implementation) ─────────────────
// Use @better-auth/utils/password which is the exact same module better-auth
// calls internally — format: "salt:hash" (scrypt via @noble/hashes).
import { hashPassword } from "@better-auth/utils/password";

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Check if any admin user already exists
  const existingAdmins = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.role, "admin"));

  if (existingAdmins.length > 0) {
    const adminEmails = existingAdmins.map((u) => u.email).join(", ");
    console.log(
      `[seed] Admin user(s) already exist: ${adminEmails}. Nothing to do.`
    );
    await pool.end();
    return;
  }

  // Check if a user with the seed email already exists (as non-admin)
  const existingUser = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, ADMIN_EMAIL));

  if (existingUser.length > 0) {
    // Promote to admin instead of re-creating
    await db
      .update(schema.users)
      .set({ role: "admin" })
      .where(eq(schema.users.email, ADMIN_EMAIL));
    console.log(
      `[seed] Promoted existing user '${ADMIN_EMAIL}' to admin.`
    );
    await pool.end();
    return;
  }

  // Create user + credential account (mirrors better-auth internal flow)
  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const now = new Date();

  await db.insert(schema.users).values({
    id: userId,
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    emailVerified: true,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.accounts).values({
    id: accountId,
    accountId: ADMIN_EMAIL,
    providerId: "credential",
    userId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  console.log("[seed] ✓ Admin user created successfully.");
  console.log(`[seed]   Email   : ${ADMIN_EMAIL}`);
  if (generatedPassword) {
    console.log(`[seed]   Password: ${ADMIN_PASSWORD}  ← SAVE THIS — shown once only`);
  } else {
    console.log("[seed]   Password: (as provided via SEED_ADMIN_PASSWORD)");
  }
  console.log("[seed] Please change the password after first login.");

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
