import { getConfig } from "@/lib/config";
import { ZabbixClient } from "@/lib/zabbix";
import { logger } from "@/lib/logger";
import { MetricChart } from "@/components/dashboard/MetricChart";
import { FadeInSection } from "@/components/dashboard/FadeInSection";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { ZabbixMetricPoint } from "@/lib/zabbix";

// ─── Default metric to display ────────────────────────────────────────────────

const DEFAULT_HOST = "localhost";
const DEFAULT_METRIC = "CPU utilization";
const DEFAULT_PERIOD = "24h";

// ─── Page props (URL search params for host/metric override) ──────────────────

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getParam(
  raw: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = raw[key];
  if (typeof v === "string") return v || undefined;
  if (Array.isArray(v)) return v[0] || undefined;
  return undefined;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MetricsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const host = getParam(rawParams, "host") ?? DEFAULT_HOST;
  const metric = getParam(rawParams, "metric") ?? DEFAULT_METRIC;
  const period = getParam(rawParams, "period") ?? DEFAULT_PERIOD;

  let metricData: ZabbixMetricPoint[] = [];
  let error: string | null = null;
  let zabbixConfigured = false;

  try {
    const cfg = await getConfig();
    if (!cfg.zabbixUrl) {
      error = "Zabbix non configuré — rendez-vous dans les paramètres.";
    } else {
      zabbixConfigured = true;
      const client = new ZabbixClient(cfg);
      metricData = await client.getMetrics({ hostName: host, metricName: metric, period });
    }
  } catch (err) {
    error = "Impossible de contacter Zabbix.";
    logger.warn("metrics page: getMetrics failed", { err: String(err) });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Métriques</h1>
        <p className="text-white/50 text-sm mt-1">
          Données d&apos;infrastructure via Zabbix
        </p>
      </div>

      {/* Filter form */}
      <FadeInSection>
        <Card>
          <CardHeader>
            <CardTitle>Paramètres du graphique</CardTitle>
            <CardDescription>
              Choisissez un hôte, une métrique et une période
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form method="GET" className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="host"
                  className="text-xs text-white/50 font-medium"
                >
                  Hôte
                </label>
                <input
                  id="host"
                  name="host"
                  type="text"
                  defaultValue={host}
                  placeholder="localhost"
                  className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/50 w-48"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="metric"
                  className="text-xs text-white/50 font-medium"
                >
                  Métrique
                </label>
                <input
                  id="metric"
                  name="metric"
                  type="text"
                  defaultValue={metric}
                  placeholder="CPU utilization"
                  className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder-white/20 focus:outline-none focus:ring-1 focus:ring-orange-500/50 w-56"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="period"
                  className="text-xs text-white/50 font-medium"
                >
                  Période
                </label>
                <select
                  id="period"
                  name="period"
                  defaultValue={period}
                  className="h-8 rounded-lg border border-white/10 bg-[#0D1B2A] px-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500/50"
                >
                  <option value="1h">1 heure</option>
                  <option value="6h">6 heures</option>
                  <option value="24h">24 heures</option>
                  <option value="7d">7 jours</option>
                  <option value="30d">30 jours</option>
                </select>
              </div>
              <button
                type="submit"
                className="h-8 px-4 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-sm font-medium transition-colors"
              >
                Appliquer
              </button>
            </form>
          </CardContent>
        </Card>
      </FadeInSection>

      {/* Chart */}
      <FadeInSection delay={0.15}>
        <Card>
          <CardHeader>
            <CardTitle>
              {metric}{" "}
              <span className="font-normal text-white/40 text-sm">
                — {host} ({period})
              </span>
            </CardTitle>
            {!zabbixConfigured && (
              <CardDescription>
                Zabbix non configuré.{" "}
                <a
                  href="/settings"
                  className="text-orange-400 hover:text-orange-300 transition-colors"
                >
                  Configurer →
                </a>
              </CardDescription>
            )}
            {error && zabbixConfigured && (
              <CardDescription className="text-red-400/70">
                {error}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <MetricChart data={metricData} title={`${metric} (%)`} />
          </CardContent>
        </Card>
      </FadeInSection>
    </div>
  );
}
