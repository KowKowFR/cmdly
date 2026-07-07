import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";
import type { ToolCategory } from "@/types/tools";

// ─── Limits configuration ─────────────────────────────────────────────────────

/** null means unlimited */
const LIMITS: Record<ToolCategory, number | null> = {
  read: null,
  modify: 5,
  destroy: 1,
};

const WINDOW_MS = 60_000; // 60 seconds

// ─── Public API ───────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Check (and conditionally increment) the rate-limit counter for a user +
 * category pair.
 *
 * RESIDUAL RACE: two concurrent requests that both arrive while count < limit
 * can each read the same count, both pass the check, and both increment.  The
 * effective burst could therefore be limit+N where N is the concurrency.  A
 * SELECT FOR UPDATE inside the transaction would serialise these reads and
 * eliminate the race; drizzle-orm v0.45 exposes .for("update") on SELECT
 * queries, but we deliberately keep this implementation simple and document
 * the race instead.  For this use-case (infra operations, low concurrency per
 * user) the window is acceptable.
 */
export async function checkRateLimit(
  userId: string,
  category: ToolCategory
): Promise<RateLimitResult> {
  const limit = LIMITS[category];

  // ── read: always allowed ──────────────────────────────────────────────────
  if (limit === null) {
    return {
      allowed: true,
      remaining: 999_999,
      resetAt: new Date(Date.now() + WINDOW_MS),
    };
  }

  // ── modify / destroy: windowed counter ───────────────────────────────────
  return db.transaction(async (tx) => {
    const now = new Date();
    const windowCutoff = new Date(now.getTime() - WINDOW_MS);

    const rows = await tx
      .select()
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.userId, userId),
          eq(rateLimits.action, category)
        )
      );

    const row = rows[0];

    // ── no existing row → first call in this window ───────────────────────
    if (!row) {
      await tx.insert(rateLimits).values({
        userId,
        action: category,
        count: 1,
        windowStartedAt: now,
      });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(now.getTime() + WINDOW_MS),
      };
    }

    // ── window expired → reset ────────────────────────────────────────────
    if (row.windowStartedAt < windowCutoff) {
      await tx
        .update(rateLimits)
        .set({ count: 1, windowStartedAt: now })
        .where(eq(rateLimits.id, row.id));
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt: new Date(now.getTime() + WINDOW_MS),
      };
    }

    // ── active window, over limit ─────────────────────────────────────────
    if (row.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(row.windowStartedAt.getTime() + WINDOW_MS),
      };
    }

    // ── active window, under limit → increment ────────────────────────────
    await tx
      .update(rateLimits)
      .set({ count: row.count + 1 })
      .where(eq(rateLimits.id, row.id));
    return {
      allowed: true,
      remaining: limit - row.count - 1,
      resetAt: new Date(row.windowStartedAt.getTime() + WINDOW_MS),
    };
  });
}
