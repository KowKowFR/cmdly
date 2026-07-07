import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditRow {
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
}

interface Props {
  rows: AuditRow[];
  page: number;
  pageSize: number;
}

// ─── Result badge ────────────────────────────────────────────────────────────

const RESULT_VARIANT: Record<
  AuditRow["result"],
  "default" | "destructive" | "secondary" | "outline"
> = {
  success: "default",
  error: "destructive",
  denied: "secondary",
};

const RESULT_LABEL: Record<AuditRow["result"], string> = {
  success: "Succès",
  error: "Erreur",
  denied: "Refusé",
};

function ResultBadge({ result }: { result: AuditRow["result"] }) {
  return (
    <Badge variant={RESULT_VARIANT[result]} className={
      result === "denied"
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
        : undefined
    }>
      {RESULT_LABEL[result]}
    </Badge>
  );
}

// ─── Params cell ─────────────────────────────────────────────────────────────

function ParamsCell({ params }: { params: unknown }) {
  if (params === null || params === undefined) return <span className="text-white/30">—</span>;
  const str = JSON.stringify(params);
  const truncated = str.length > 80 ? str.slice(0, 80) + "…" : str;
  return (
    <code className="text-xs text-white/50 font-mono break-all" title={str}>
      {truncated}
    </code>
  );
}

// ─── AuditTable ──────────────────────────────────────────────────────────────

export default function AuditTable({ rows, page, pageSize }: Props) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-white/50">
          Aucun événement trouvé pour les filtres actuels.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-white/50 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-medium">Date</th>
              <th className="text-left px-4 py-3 font-medium">Utilisateur</th>
              <th className="text-left px-4 py-3 font-medium">Action</th>
              <th className="text-left px-4 py-3 font-medium">Résultat</th>
              <th className="text-left px-4 py-3 font-medium">Outil</th>
              <th className="text-left px-4 py-3 font-medium">IP</th>
              <th className="text-left px-4 py-3 font-medium">Paramètres</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                  i % 2 === 0 ? "" : "bg-white/[0.02]"
                }`}
              >
                <td className="px-4 py-3 text-white/70 whitespace-nowrap">
                  {formatDate(row.createdAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="text-white/90">{row.userEmail ?? "—"}</div>
                  {row.userName && (
                    <div className="text-white/40 text-xs">{row.userName}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-white/80 font-mono text-xs whitespace-nowrap">
                  {row.action}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <ResultBadge result={row.result} />
                  {row.errorMessage && (
                    <div
                      className="text-red-400/70 text-xs mt-1 max-w-[200px] truncate"
                      title={row.errorMessage}
                    >
                      {row.errorMessage}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-white/60 font-mono text-xs whitespace-nowrap">
                  {row.toolName ?? "—"}
                </td>
                <td className="px-4 py-3 text-white/50 font-mono text-xs whitespace-nowrap">
                  {row.ipAddress ?? "—"}
                </td>
                <td className="px-4 py-3 max-w-[240px]">
                  <ParamsCell params={row.params} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === pageSize && (
          <div className="px-4 py-3 text-white/40 text-xs border-t border-white/10">
            Page {page} — {pageSize} entrées affichées. Il peut y en avoir davantage.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return String(d);
  }
}
