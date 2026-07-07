/**
 * In-memory IP-keyed rate limiter for the LDAP authentication route.
 *
 * Limits failed LDAP bind attempts to FAIL_LIMIT per WINDOW_SEC per client IP.
 * After FAIL_LIMIT failures within the window, subsequent attempts are blocked
 * until the window expires naturally.
 *
 * NOTE: Single-instance in-memory store — consistent with the app's other
 * in-memory helpers (e.g. SSH session map). State is lost on process restart
 * and is NOT shared across multiple Node.js replicas. For multi-instance
 * deployments, replace with a Redis-backed or DB-backed counter.
 */

import { logger } from "@/lib/logger";

const FAIL_LIMIT = 5;
export const WINDOW_SEC = 900; // 15 minutes — exported for tests

interface LdapIpEntry {
  fails: number;
  windowStart: number; // unix timestamp in seconds
}

// Module-level map: ip → { fails, windowStart }
const store = new Map<string, LdapIpEntry>();

export interface RateLimitCheck {
  blocked: boolean;
  retryAfterSec?: number;
}

/**
 * Check whether the given IP is currently rate-limited.
 *
 * Call BEFORE attempting the LDAP bind. If blocked, return 429 immediately
 * and DO NOT attempt the bind against the directory.
 *
 * Returns `{ blocked: true, retryAfterSec }` when the IP has >= FAIL_LIMIT
 * failures within the current WINDOW_SEC window.  Returns `{ blocked: false }`
 * otherwise (including when the window has expired, in which case the stale
 * entry is cleaned up).
 */
export function recordAndCheck(ip: string): RateLimitCheck {
  const now = Math.floor(Date.now() / 1000);
  const entry = store.get(ip);

  if (!entry) return { blocked: false };

  // Window expired → clean up stale entry and allow the request
  if (now - entry.windowStart >= WINDOW_SEC) {
    store.delete(ip);
    return { blocked: false };
  }

  if (entry.fails >= FAIL_LIMIT) {
    const retryAfterSec = WINDOW_SEC - (now - entry.windowStart);
    logger.warn("LDAP rate limit: IP blocked", { ip, fails: entry.fails, retryAfterSec });
    return { blocked: true, retryAfterSec };
  }

  return { blocked: false };
}

/**
 * Record a failed LDAP bind attempt for the given IP.
 * Call AFTER a failed bind to increment (or start) the failure counter.
 * If the previous window has expired it is reset here as well.
 */
export function recordFailure(ip: string): void {
  const now = Math.floor(Date.now() / 1000);
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_SEC) {
    // Start a fresh window with one failure
    store.set(ip, { fails: 1, windowStart: now });
  } else {
    store.set(ip, { fails: entry.fails + 1, windowStart: entry.windowStart });
  }
}

/**
 * Clear the rate-limit entry for the given IP after a successful bind.
 * A successful login resets the counter so the user is not penalised.
 */
export function recordSuccess(ip: string): void {
  store.delete(ip);
}
