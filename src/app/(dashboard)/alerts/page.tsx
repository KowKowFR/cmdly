import { getConfig } from "@/lib/config";
import { WazuhClient } from "@/lib/wazuh";
import { logger } from "@/lib/logger";
import { AlertBadge } from "@/components/dashboard/AlertBadge";
import { FadeInSection } from "@/components/dashboard/FadeInSection";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { WazuhAlert } from "@/lib/wazuh";

// ─── Severity summary ─────────────────────────────────────────────────────────

function countBySeverity(alerts: WazuhAlert[]) {
  const critical = alerts.filter((a) => a.level >= 12).length;
  const high = alerts.filter((a) => a.level >= 7 && a.level < 12).length;
  const medium = alerts.filter((a) => a.level >= 4 && a.level < 7).length;
  const low = alerts.filter((a) => a.level < 4).length;
  return { critical, high, medium, low };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AlertsPage() {
  let alerts: WazuhAlert[] = [];
  let error: string | null = null;

  try {
    const cfg = await getConfig();
    if (!cfg.wazuhUrl) {
      error = "Wazuh non configuré — rendez-vous dans les paramètres.";
    } else {
      const client = new WazuhClient(cfg);
      alerts = await client.searchAlerts({ query: "*", limit: 50 });
    }
  } catch (err) {
    error = "Impossible de contacter Wazuh Indexer.";
    logger.warn("alerts page: searchAlerts failed", { err: String(err) });
  }

  const { critical, high, medium, low } = countBySeverity(alerts);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Alertes</h1>
        <p className="text-white/50 text-sm mt-1">
          Flux d&apos;alertes Wazuh — 50 plus récentes
        </p>
      </div>

      {/* Severity summary */}
      {!error && alerts.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {critical > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              {critical} critique{critical !== 1 ? "s" : ""}
            </span>
          )}
          {high > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-xs text-orange-400">
              {high} élevé{high !== 1 ? "s" : ""}
            </span>
          )}
          {medium > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
              {medium} moyen{medium !== 1 ? "s" : ""}
            </span>
          )}
          {low > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/50">
              {low} faible{low !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {error ? (
        <FadeInSection>
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center space-y-2">
            <p className="text-white/50 text-sm">{error}</p>
            <a
              href="/settings"
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              Configurer Wazuh →
            </a>
          </div>
        </FadeInSection>
      ) : alerts.length === 0 ? (
        <FadeInSection>
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center">
            <p className="text-white/50 text-sm">Aucune alerte trouvée.</p>
          </div>
        </FadeInSection>
      ) : (
        <FadeInSection delay={0.1}>
          <Card>
            <CardHeader>
              <CardTitle>Alertes récentes</CardTitle>
              <CardDescription>
                {alerts.length} alerte{alerts.length !== 1 ? "s" : ""} trouvée
                {alerts.length !== 1 ? "s" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.map((alert) => (
                <AlertBadge key={alert.id} alert={alert} />
              ))}
            </CardContent>
          </Card>
        </FadeInSection>
      )}
    </div>
  );
}
