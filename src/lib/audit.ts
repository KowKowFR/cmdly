import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

// ─── Action → result-enum mapping ────────────────────────────────────────────
//
// The auditLog.result column is an enum: "success" | "error" | "denied".
// We store the full lifecycle stage in `action` (which is a free-text varchar)
// and derive the enum value here:
//
//   tool_call_attempted  → "success"  (neutral; just records the intent)
//   tool_call_succeeded  → "success"
//   tool_call_failed     → "error"
//   tool_call_denied     → "denied"

type AuditAction =
  | "tool_call_attempted"
  | "tool_call_succeeded"
  | "tool_call_failed"
  | "tool_call_denied";

type AuditResult = "success" | "error" | "denied";

const ACTION_RESULT_MAP: Record<AuditAction, AuditResult> = {
  tool_call_attempted: "success",
  tool_call_succeeded: "success",
  tool_call_failed: "error",
  tool_call_denied: "denied",
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AuditRow {
  userId: string;
  action: AuditAction;
  toolName?: string | null;
  params?: unknown;
  result?: unknown;
  errorMessage?: string | null;
  ipAddress: string;
}

/**
 * Append-only INSERT into auditLog.  Never throws — failures are logged via
 * logger so that a DB issue never breaks the request pipeline.
 *
 * params / result are serialised with JSON.stringify (circular-safe fallback).
 * Callers are responsible for NOT passing raw secret values in params.
 */
export async function audit(row: AuditRow): Promise<void> {
  try {
    const resultEnum = ACTION_RESULT_MAP[row.action];

    // Safe JSON serialisation (guards against circular structures)
    let paramsJson: unknown = null;
    if (row.params !== undefined) {
      try {
        paramsJson = JSON.parse(JSON.stringify(row.params));
      } catch {
        paramsJson = { _serialisationError: "params not serialisable" };
      }
    }

    await db.insert(auditLog).values({
      userId: row.userId,
      action: row.action,
      toolName: row.toolName ?? null,
      params: paramsJson as Record<string, unknown> | null,
      result: resultEnum,
      errorMessage: row.errorMessage ?? null,
      ipAddress: row.ipAddress,
    });
  } catch (err) {
    logger.error("audit: failed to write audit log row", {
      err: String(err),
      action: row.action,
      userId: row.userId,
      toolName: row.toolName ?? undefined,
    });
  }
}
