import type { WazuhAlert } from "@/lib/wazuh";

function severityLabel(level: number): {
  text: string;
  className: string;
} {
  if (level >= 12)
    return {
      text: `Critique (${level})`,
      className:
        "bg-red-500/20 text-red-400 border border-red-500/30",
    };
  if (level >= 7)
    return {
      text: `Élevé (${level})`,
      className:
        "bg-orange-500/20 text-orange-400 border border-orange-500/30",
    };
  if (level >= 4)
    return {
      text: `Moyen (${level})`,
      className:
        "bg-amber-500/20 text-amber-400 border border-amber-500/30",
    };
  return {
    text: `Faible (${level})`,
    className:
      "bg-white/10 text-white/50 border border-white/10",
  };
}

function fmtTimestamp(ts: string): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

interface AlertBadgeProps {
  alert: WazuhAlert;
}

export function AlertBadge({ alert }: AlertBadgeProps) {
  const { text, className } = severityLabel(alert.level);

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 mt-0.5 ${className}`}
      >
        {text}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white leading-snug truncate">
          {alert.description || "Alerte sans description"}
        </p>
        <p className="text-xs text-white/40 mt-0.5">
          {alert.agentName || "Inconnu"} · {fmtTimestamp(alert.timestamp)}
        </p>
      </div>
    </div>
  );
}
