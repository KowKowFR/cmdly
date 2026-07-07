import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { headers } from "next/headers";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24, // 24 hours
    updateAge: 60 * 60,       // refresh if older than 1 hour
  },
  user: {
    additionalFields: {
      role: {
        type: ["viewer", "operator", "admin"] as const,
        required: false,
        defaultValue: "viewer",
        input: false, // users cannot set their own role
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 900, // 15 minutes
        max: 5,       // 5 attempts max
      },
    },
  },
});

/**
 * Get the current session from server components or route handlers.
 * Returns session+user or null.
 */
export async function getSession() {
  try {
    return await auth.api.getSession({
      headers: await headers(),
    });
  } catch (err) {
    logger.error("getSession failed", { err: String(err) });
    return null;
  }
}
