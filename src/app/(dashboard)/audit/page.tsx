import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { parseAuditFilters, buildAuditWhere } from "@/lib/audit-query";
import { logger } from "@/lib/logger";
import AuditFiltersComponent from "@/components/audit/AuditFilters";
import AuditTable from "@/components/audit/AuditTable";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─── Page props ───────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ─── AuditPage ────────────────────────────────────────────────────────────────

export default async function AuditPage({ searchParams }: PageProps) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    redirect("/");
  }

  // ── Parse filters from URL ──────────────────────────────────────────────────
  const rawParams = await searchParams;
  const filters = parseAuditFilters(rawParams);
  const pageParam = rawParams.page;
  const pageStr =
    typeof pageParam === "string"
      ? pageParam
      : Array.isArray(pageParam) && pageParam.length > 0
      ? (pageParam[0] ?? "1")
      : "1";
  const page = Math.max(1, parseInt(pageStr, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const where = buildAuditWhere(filters);

  // ── Fetch rows ──────────────────────────────────────────────────────────────
  let rows: Awaited<ReturnType<typeof fetchRows>> = [];
  try {
    rows = await fetchRows(where, PAGE_SIZE, offset);
  } catch (err) {
    logger.error("audit page: db fetch failed", { err: String(err) });
  }

  // ── Build CSV export URL ────────────────────────────────────────────────────
  const exportParams = new URLSearchParams();
  if (filters.userId) exportParams.set("userId", filters.userId);
  if (filters.toolName) exportParams.set("toolName", filters.toolName);
  if (filters.result) exportParams.set("result", filters.result);
  if (filters.from) exportParams.set("from", filters.from);
  if (filters.to) exportParams.set("to", filters.to);
  const exportQs = exportParams.toString();
  const exportUrl = `/api/audit/export${exportQs ? `?${exportQs}` : ""}`;

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal d'audit</h1>
          <p className="text-white/60 text-sm mt-1">
            Historique de toutes les actions administratives sur la plateforme
          </p>
        </div>
        <a
          href={exportUrl}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "shrink-0"
          )}
        >
          Exporter CSV
        </a>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Filtres</CardTitle>
          <CardDescription>
            Affinez les événements affichés et exportés
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditFiltersComponent initialFilters={filters} />
        </CardContent>
      </Card>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <AuditTable rows={rows} page={page} pageSize={PAGE_SIZE} />

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {(page > 1 || rows.length === PAGE_SIZE) && (
        <div className="flex items-center justify-between text-sm text-white/50">
          {page > 1 ? (
            <a
              href={buildPageUrl(rawParams, page - 1)}
              className="hover:text-white transition-colors"
            >
              ← Page précédente
            </a>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {rows.length === PAGE_SIZE ? (
            <a
              href={buildPageUrl(rawParams, page + 1)}
              className="hover:text-white transition-colors"
            >
              Page suivante →
            </a>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DB query ─────────────────────────────────────────────────────────────────

async function fetchRows(
  where: ReturnType<typeof buildAuditWhere>,
  limit: number,
  offset: number
) {
  return db
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
    .limit(limit)
    .offset(offset);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildPageUrl(
  raw: Record<string, string | string[] | undefined>,
  targetPage: number
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (k === "page") continue;
    const val = typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
    if (val) params.set(k, val);
  }
  if (targetPage > 1) params.set("page", String(targetPage));
  const qs = params.toString();
  return `/audit${qs ? `?${qs}` : ""}`;
}
