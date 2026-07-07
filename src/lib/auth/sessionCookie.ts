/**
 * Cookie signing helper — mirrors better-call's signed-cookie algorithm.
 *
 * better-call's `setSignedCookie` / `getSignedCookie` format:
 *   encodeURIComponent(`${value}.${base64(HMAC-SHA256(value, secret))}`)
 *
 * This module is the single source of truth for that algorithm inside CMDLY.
 * The LDAP route imports `signCookieValue` from here rather than re-defining it
 * inline, so the session.test.ts round-trip + getSession integration test can
 * import the same function and will fail loudly if the scheme ever drifts from
 * what better-auth actually verifies.
 *
 * Residual concern: `better-auth` / `better-call` are NOT pinned to an exact
 * version in package.json.  Pin both (e.g. `"better-auth": "1.6.23"`) to
 * prevent a silent signing-scheme change from breaking LDAP sessions after an
 * `npm update`.
 */

import { createHmac } from "crypto";

/**
 * Sign a cookie value with HMAC-SHA256 using the provided secret.
 * Produces the same format as better-call's `setSignedCookie`.
 *
 * @param value  The raw session token (e.g. `session.token` from createSession)
 * @param secret The HMAC secret (= `ctx.secret` from better-auth's auth context)
 * @returns      A URL-encoded string `token.base64sig` ready to write as the
 *               cookie value.
 */
export function signCookieValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret)
    .update(value)
    .digest("base64");
  return encodeURIComponent(`${value}.${signature}`);
}

/**
 * Verify a signed cookie value produced by `signCookieValue`.
 * Returns the original `value` (token) on success, or `null` if the signature
 * is missing or doesn't match.  Used in tests to confirm round-trip correctness.
 *
 * @param signed  The raw cookie value as received from the `Cookie` header
 * @param secret  The same HMAC secret used when signing
 */
export function verifyCookieValue(signed: string, secret: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(signed);
  } catch {
    return null;
  }

  const lastDot = decoded.lastIndexOf(".");
  if (lastDot === -1) return null;

  const value = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);

  const expected = createHmac("sha256", secret)
    .update(value)
    .digest("base64");

  // Constant-time comparison is not required here (this is test-only code),
  // but we keep it simple and correct.
  if (sig !== expected) return null;
  return value;
}
