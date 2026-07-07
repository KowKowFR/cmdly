import { SQL, and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "@/lib/db/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditFilters {
  userId?: string;
  toolName?: string;
  result?: "success" | "error" | "denied";
  from?: string;
  to?: string;
}

// ─── Zod schema for the result enum ─────────────────────────────────────────

const resultEnum = z.enum(["success", "error", "denied"]);

// ─── parseAuditFilters ────────────────────────────────────────────────────────

/**
 * Safely parses raw searchParams into AuditFilters.
 * Invalid result values and unparseable dates are silently dropped.
 */
export function parseAuditFilters(
  raw: Record<string, string | string[] | undefined>
): AuditFilters {
  const get = (k: string): string | undefined => {
    const v = raw[k];
    if (typeof v === "string") return v || undefined;
    if (Array.isArray(v) && v.length > 0) return v[0] || undefined;
    return undefined;
  };

  const filters: AuditFilters = {};

  const userId = get("userId");
  if (userId) filters.userId = userId;

  const toolName = get("toolName");
  if (toolName) filters.toolName = toolName;

  const resultRaw = get("result");
  if (resultRaw) {
    const parsed = resultEnum.safeParse(resultRaw);
    if (parsed.success) filters.result = parsed.data;
  }

  const from = get("from");
  if (from) {
    const d = Date.parse(from);
    if (!isNaN(d)) filters.from = from;
  }

  const to = get("to");
  if (to) {
    const d = Date.parse(to);
    if (!isNaN(d)) filters.to = to;
  }

  return filters;
}

// ─── buildAuditWhere ─────────────────────────────────────────────────────────

/**
 * Converts AuditFilters into a Drizzle SQL where clause (or undefined if no filters).
 */
export function buildAuditWhere(filters: AuditFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.userId) {
    conditions.push(eq(auditLog.userId, filters.userId));
  }
  if (filters.toolName) {
    conditions.push(eq(auditLog.toolName, filters.toolName));
  }
  if (filters.result) {
    conditions.push(eq(auditLog.result, filters.result));
  }
  if (filters.from) {
    const d = new Date(filters.from);
    if (!isNaN(d.getTime())) conditions.push(gte(auditLog.createdAt, d));
  }
  if (filters.to) {
    const d = new Date(filters.to);
    if (!isNaN(d.getTime())) conditions.push(lte(auditLog.createdAt, d));
  }

  if (conditions.length === 0) return undefined;
  return and(...conditions);
}
