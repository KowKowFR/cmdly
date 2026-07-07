/**
 * POST /api/auth/ldap
 *
 * LDAP authentication endpoint. When LDAP is enabled in the infrastructure
 * config, this route:
 *   1. Checks the Origin header against BETTER_AUTH_URL (CSRF guard).
 *   2. Checks the client IP against the in-memory rate-limit store.
 *   3. Validates the JSON body { username, password }.
 *   4. Calls ldapBind to verify the user against the directory.
 *   5. Find-or-creates a local `users` row (passwordHash stays null — LDAP
 *      users have no local password).
 *   6. Issues a better-auth session by calling
 *      `(await auth.$context).internalAdapter.createSession(userId)`.
 *      The returned session token is HMAC-SHA256–signed (same algorithm that
 *      better-call uses internally) and written as the `better-auth.session_token`
 *      signed cookie so that subsequent requests through better-auth's
 *      `getSession()` work transparently.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

import { getConfig } from "@/lib/config";
import { ldapBind } from "@/lib/auth/ldap";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { signCookieValue } from "@/lib/auth/sessionCookie";
import {
  recordAndCheck,
  recordFailure,
  recordSuccess,
} from "@/lib/auth/ldapRateLimit";

// ─── Input schema ─────────────────────────────────────────────────────────────

const LdapLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the client IP from the request.
 * Prefers the first hop in X-Forwarded-For (set by reverse proxies).
 * Falls back to X-Real-IP, then "unknown".
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. CSRF origin check
  //
  // Design choice: reject only when the Origin header is PRESENT and does NOT
  // match BETTER_AUTH_URL.  Absent-Origin requests are allowed because
  // same-origin fetches from Next.js server components / RSC may omit the
  // Origin header entirely (e.g. server-side test helpers, curl without -H).
  // Rejecting absent-Origin would break those legitimate callers while offering
  // minimal additional security over rejecting mismatched origins.
  const origin = req.headers.get("origin");
  const trustedOrigin = process.env.BETTER_AUTH_URL;
  if (origin !== null && trustedOrigin && origin !== trustedOrigin) {
    logger.warn("LDAP: rejected request with mismatched Origin", { origin, trustedOrigin });
    return NextResponse.json(
      { ok: false, error: "Origine non autorisée" },
      { status: 403 },
    );
  }

  // 2. Check if LDAP is enabled
  const config = await getConfig();
  if (!config.ldapEnabled) {
    return NextResponse.json({ error: "LDAP authentication is not enabled" }, { status: 400 });
  }

  // 3. Parse and validate body
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

  // 4. IP-based rate limiting — check BEFORE touching LDAP
  //
  // 5 failed attempts per 15 minutes (900 s) per client IP.  The in-memory
  // store is single-instance (consistent with the app's other in-memory stores).
  const clientIp = getClientIp(req);
  const rlCheck = recordAndCheck(clientIp);
  if (rlCheck.blocked) {
    return NextResponse.json(
      { ok: false, error: "Trop de tentatives. Réessayez plus tard." },
      {
        status: 429,
        headers: rlCheck.retryAfterSec !== undefined
          ? { "Retry-After": String(rlCheck.retryAfterSec) }
          : {},
      },
    );
  }

  // 5. LDAP bind
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
    recordFailure(clientIp);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Successful bind — clear any accumulated failure counter for this IP
  recordSuccess(clientIp);

  // 6. Find-or-create local user row
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

  // 7. Issue a better-auth session
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
