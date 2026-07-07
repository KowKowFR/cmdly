import { count, gte } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { ProxmoxClient } from "@/lib/proxmox";
import { WazuhClient } from "@/lib/wazuh";
import { ZabbixClient } from "@/lib/zabbix";
import { logger } from "@/lib/logger";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { VMCard } from "@/components/dashboard/VMCard";
import { AlertBadge } from "@/components/dashboard/AlertBadge";
import { MetricChart } from "@/components/dashboard/MetricChart";
import { FadeInSection } from "@/components/dashboard/FadeInSection";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ProxmoxVm } from "@/lib/proxmox";
import type { WazuhAlert } from "@/lib/wazuh";
import type { ZabbixMetricPoint } from "@/lib/zabbix";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAvgUptime(vms: ProxmoxVm[]): string {
  const running = vms.filter((v) => v.status === "running" && v.uptime > 0);
  if (running.length === 0) return "—";
  const avg = running.reduce((s, v) => s + v.uptime, 0) / running.length;
  const days = Math.floor(avg / 86400);
  const hours = Math.floor((avg % 86400) / 3600);
  if (days > 0) return `${days} j ${hours} h`;
  return `${hours} h`;
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchDashboardData() {
  // 1. Config — may fail if DB is down
  let cfg = await getConfig().catch((err) => {
    logger.warn("dashboard: getConfig failed", { err: String(err) });
    return null;
  });

  // 2. Proxmox VMs
  let vms: ProxmoxVm[] = [];
  let proxmoxError: string | null = null;
  if (cfg?.proxmoxHost) {
    try {
      const client = new ProxmoxClient(cfg);
      vms = await client.listVms();
    } catch (err) {
      proxmoxError = "Impossible de contacter Proxmox";
      logger.warn("dashboard: listVms failed", { err: String(err) });
    }
  } else {
    proxmoxError = "Proxmox non configuré";
  }

  // 3. Wazuh alerts (last 24h)
  let alerts: WazuhAlert[] = [];
  let wazuhError: string | null = null;
  if (cfg?.wazuhUrl) {
    try {
      const client = new WazuhClient(cfg);
      alerts = await client.searchAlerts({ query: "*", limit: 10 });
    } catch (err) {
      wazuhError = "Impossible de contacter Wazuh";
      logger.warn("dashboard: searchAlerts failed", { err: String(err) });
    }
  } else {
    wazuhError = "Wazuh non configuré";
  }

  // 4. Zabbix metrics (CPU 24h)
  let metricData: ZabbixMetricPoint[] = [];
  if (cfg?.zabbixUrl) {
    try {
      const client = new ZabbixClient(cfg);
      metricData = await client.getMetrics({
        hostName: "localhost",
        metricName: "CPU utilization",
        period: "24h",
      });
    } catch (err) {
      logger.warn("dashboard: getMetrics failed", { err: String(err) });
    }
  }

  // 5. CMDLY actions last 24h (from audit log in DB)
  let actionCount = 0;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await db
      .select({ total: count() })
      .from(auditLog)
      .where(gte(auditLog.createdAt, since));
    actionCount = Number(result[0]?.total ?? 0);
  } catch (err) {
    logger.warn("dashboard: audit count failed", { err: String(err) });
  }

  const activeVmCount = vms.filter((v) => v.status === "running").length;
  const avgUptime = fmtAvgUptime(vms);

  return {
    vms,
    alerts,
    metricData,
    activeVmCount,
    alertCount: alerts.length,
    avgUptime,
    actionCount,
    proxmoxError,
    wazuhError,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const data = await fetchDashboardData();

  const recentVms = data.vms.slice(0, 6);
  const recentAlerts = data.alerts.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-white">Vue d&apos;ensemble</h1>
        <p className="text-white/50 text-sm mt-1">
          Tableau de bord de l&apos;infrastructure CMDLY
        </p>
      </div>

      {/* Stats grid */}
      <StatsGrid
        vmCount={data.activeVmCount}
        alertCount={data.alertCount}
        avgUptime={data.avgUptime}
        actionCount={data.actionCount}
      />

      {/* VM grid */}
      <FadeInSection delay={0.2}>
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-white">
              Machines virtuelles
            </h2>
            <a
              href="/vms"
              className="text-xs text-white/40 hover:text-white transition-colors"
            >
              Voir tout →
            </a>
          </div>

          {data.proxmoxError ? (
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center">
              <p className="text-white/40 text-sm">{data.proxmoxError}</p>
            </div>
          ) : recentVms.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-6 text-center">
              <p className="text-white/40 text-sm">Aucune VM trouvée</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {recentVms.map((vm) => (
                <VMCard key={vm.vmid} vm={vm} />
              ))}
            </div>
          )}
        </div>
      </FadeInSection>

      {/* Two-column: alerts + chart */}
      <FadeInSection delay={0.35}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent alerts */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Alertes récentes</CardTitle>
                <a
                  href="/alerts"
                  className="text-xs text-white/40 hover:text-white transition-colors"
                >
                  Voir tout →
                </a>
              </div>
            </CardHeader>
            <CardContent>
              {data.wazuhError ? (
                <p className="text-white/40 text-sm py-4 text-center">
                  {data.wazuhError}
                </p>
              ) : recentAlerts.length === 0 ? (
                <p className="text-white/40 text-sm py-4 text-center">
                  Aucune alerte
                </p>
              ) : (
                <div>
                  {recentAlerts.map((alert) => (
                    <AlertBadge key={alert.id} alert={alert} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metrics chart */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>CPU moyen 24h</CardTitle>
                <a
                  href="/metrics"
                  className="text-xs text-white/40 hover:text-white transition-colors"
                >
                  Détails →
                </a>
              </div>
            </CardHeader>
            <CardContent>
              <MetricChart data={data.metricData} title="Utilisation CPU (%)" />
            </CardContent>
          </Card>
        </div>
      </FadeInSection>
    </div>
  );
}
