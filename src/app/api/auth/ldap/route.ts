/**
 * POST /api/auth/ldap
 *
 * LDAP authentication endpoint. When LDAP is enabled in the infrastructure
 * config, this route:
 *   1. Validates the JSON body { username, password }.
 *   2. Calls ldapBind to verify the user against the directory.
 *   3. Find-or-creates a local `users` row (passwordHash stays null — LDAP
 *      users have no local password).
 *   4. Issues a better-auth session by calling
 *      `(await auth.$context).internalAdapter.createSession(userId)`.
 *      The returned session token is HMAC-SHA256–signed (same algorithm that
 *      better-call uses internally) and written as the `better-auth.session_token`
 *      signed cookie so that subsequent requests through better-auth's
 *      `getSession()` work transparently.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { createHmac, randomUUID } from "crypto";

import { getConfig } from "@/lib/config";
import { ldapBind } from "@/lib/auth/ldap";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// ─── Input schema ─────────────────────────────────────────────────────────────

const LdapLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// ─── Cookie signing (mirrors better-call's signCookieValue) ──────────────────

/**
 * Sign a cookie value with HMAC-SHA256 using the better-auth secret.
 * Produces the same format as better-call's `setSignedCookie`:
 *   encodeURIComponent(`${value}.${base64Signature}`)
 */
function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(value)
    .digest("base64");
  return encodeURIComponent(`${value}.${signature}`);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Check if LDAP is enabled
  const config = await getConfig();
  if (!config.ldapEnabled) {
    return NextResponse.json({ error: "LDAP authentication is not enabled" }, { status: 400 });
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LdapLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 },
    );
  }

  const { username, password } = parsed.data;

  // 3. LDAP bind
  const ldapResult = await ldapBind(
    {
      ldapUrl: config.ldapUrl,
      ldapBindDn: config.ldapBindDn,
      ldapBindPassword: config.ldapBindPassword,
      ldapBaseDn: config.ldapBaseDn,
    },
    username,
    password,
  );

  if (!ldapResult.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // 4. Find-or-create local user row
  // Normalize to email: if username looks like an email use it; otherwise
  // derive a synthetic email so the unique constraint is satisfied.
  const email = username.includes("@") ? username : `${username}@ldap.local`;
  const name = username.split("@")[0] ?? username;

  let userId: string;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    userId = existing[0]!.id;
  } else {
    userId = randomUUID();
    await db.insert(users).values({
      id: userId,
      email,
      name,
      emailVerified: true,
      role: "viewer",
      // passwordHash intentionally omitted (null) — LDAP users have no local password
    });
    logger.info("LDAP: created local user row", { userId, email });
  }

  // 5. Issue a better-auth session
  //
  // We access better-auth's internal adapter through `auth.$context` (a Promise
  // that resolves to the AuthContext). `internalAdapter.createSession(userId)`
  // inserts a session row into the `sessions` table and returns the session
  // record with a `token` field. We then sign the token using HMAC-SHA256 with
  // the same algorithm better-call uses for signed cookies, and set it as the
  // `better-auth.session_token` cookie so that `getSession()` in server
  // components works transparently.
  const ctx = await auth.$context;
  const session = await ctx.internalAdapter.createSession(userId);

  if (!session) {
    logger.error("LDAP: failed to create session", { userId });
    return NextResponse.json({ error: "Session creation failed" }, { status: 500 });
  }

  const cookieName: string = ctx.authCookies.sessionToken.name;
  const cookieAttrs = ctx.authCookies.sessionToken.attributes;
  const secret: string = ctx.secret;

  const signedValue = signCookieValue(session.token, secret);

  // Build Set-Cookie header attributes
  const maxAge = cookieAttrs.maxAge !== undefined ? `; Max-Age=${cookieAttrs.maxAge}` : "";
  const secure = cookieAttrs.secure ? "; Secure" : "";
  const sameSite = cookieAttrs.sameSite ? `; SameSite=${cookieAttrs.sameSite}` : "";
  const path = cookieAttrs.path ? `; Path=${cookieAttrs.path}` : "; Path=/";

  const cookieHeader = `${cookieName}=${signedValue}; HttpOnly${secure}${sameSite}${path}${maxAge}`;

  logger.info("LDAP: session issued", { userId, cookie: cookieName });

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.headers.append("Set-Cookie", cookieHeader);
  return response;
}
