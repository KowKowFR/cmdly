import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { ZabbixClient } from "@/lib/zabbix";

export const getZabbixMetrics: Tool = {
  name: "get_zabbix_metrics",
  description:
    "Récupère les métriques de monitoring Zabbix pour un hôte et un indicateur donnés sur une période (ex: 1h, 24h, 7d).",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({
    hostName: z.string().min(1),
    metricName: z.string().min(1),
    period: z.string().min(1),
  }),

  async execute(params, ctx) {
    const { hostName, metricName, period } = params as {
      hostName: string;
      metricName: string;
      period: string;
    };

    try {
      const client = new ZabbixClient(ctx.config);
      const points = await client.getMetrics({ hostName, metricName, period });

      const humanReadable =
        points.length === 0
          ? `Aucune donnée pour "${metricName}" sur "${hostName}" (période: ${period}).`
          : [
              `Métrique "${metricName}" sur "${hostName}" — ${points.length} points (${period}):`,
              ...points.slice(-5).map((p) => {
                const ts = new Date(p.clock * 1000).toISOString();
                return `  ${ts}: ${p.value}`;
              }),
            ].join("\n");

      return { success: true, data: points, humanReadable };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur Zabbix: ${error}` };
    }
  },
};

register(getZabbixMetrics);
