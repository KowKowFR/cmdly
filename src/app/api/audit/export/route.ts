import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { parseAuditFilters, buildAuditWhere } from "@/lib/audit-query";
import { logger } from "@/lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ROWS = 10_000;

// CSV columns
const CSV_HEADERS = [
  "createdAt",
  "userEmail",
  "userName",
  "action",
  "toolName",
  "result",
  "ipAddress",
  "errorMessage",
  "params",
];

// ─── GET /api/audit/export ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Admin guard ─────────────────────────────────────────────────────────────
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    logger.warn("audit export: unauthorized access attempt", {
      userId: session?.user?.id ?? "anonymous",
    });
    return NextResponse.json(
      { error: "Accès réservé aux administrateurs." },
      { status: 403 }
    );
  }

  // ── Parse filters ───────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const rawParams: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    rawParams[key] = value;
  });

  const filters = parseAuditFilters(rawParams);
  const where = buildAuditWhere(filters);

  // ── Fetch rows ──────────────────────────────────────────────────────────────
  let rows: Array<{
    id: number;
    action: string;
    toolName: string | null;
    params: unknown;
    result: "success" | "error" | "denied";
    errorMessage: string | null;
    ipAddress: string | null;
    createdAt: Date;
    userEmail: string | null;
    userName: string | null;
  }> = [];

  try {
    rows = await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        toolName: auditLog.toolName,
        params: auditLog.params,
        result: auditLog.result,
        errorMessage: auditLog.errorMessage,
        ipAddress: auditLog.ipAddress,
        createdAt: auditLog.createdAt,
        userEmail: users.email,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(MAX_ROWS);
  } catch (err) {
    logger.error("audit export: db fetch failed", { err: String(err) });
    return NextResponse.json(
      { error: "Erreur lors de la récupération des données." },
      { status: 500 }
    );
  }

  // ── Build CSV ───────────────────────────────────────────────────────────────
  const lines: string[] = [CSV_HEADERS.map(escapeField).join(",")];

  for (const row of rows) {
    const fields = [
      row.createdAt.toISOString(),
      row.userEmail ?? "",
      row.userName ?? "",
      row.action,
      row.toolName ?? "",
      row.result,
      row.ipAddress ?? "",
      row.errorMessage ?? "",
      row.params !== null && row.params !== undefined
        ? JSON.stringify(row.params)
        : "",
    ];
    lines.push(fields.map(escapeField).join(","));
  }

  const csv = lines.join("\r\n") + "\r\n";

  // ── Filename ────────────────────────────────────────────────────────────────
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `cmdly-audit-${dateTag}.csv`;

  logger.info("audit export: CSV generated", {
    userId: session.user.id,
    rowCount: rows.length,
    filters,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ─── CSV escaping (RFC 4180) ──────────────────────────────────────────────────

/**
 * Escapes a single CSV field:
 * - Wraps in double-quotes if the field contains a comma, double-quote, newline, or CR.
 * - Doubles any internal double-quote characters.
 */
function escapeField(value: string): string {
  const needsQuoting =
    value.includes('"') ||
    value.includes(",") ||
    value.includes("\n") ||
    value.includes("\r");

  if (!needsQuoting) return value;
  // Double internal quotes, then wrap in quotes
  return `"${value.replace(/"/g, '""')}"`;
}
