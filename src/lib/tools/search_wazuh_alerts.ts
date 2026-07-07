import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { WazuhClient } from "@/lib/wazuh";

export const searchWazuhAlerts: Tool = {
  name: "search_wazuh_alerts",
  description:
    "Recherche des alertes de sécurité dans Wazuh par mot-clé et niveau de sévérité.",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({
    query: z.string().min(1),
    severity: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),

  async execute(params, ctx) {
    const { query, severity, limit } = params as {
      query: string;
      severity?: string;
      limit?: number;
    };

    try {
      const client = new WazuhClient(ctx.config);
      const alerts = await client.searchAlerts({ query, severity, limit });

      const humanReadable =
        alerts.length === 0
          ? "Aucune alerte trouvée."
          : alerts
              .map(
                (a) =>
                  `[L${a.level}] ${a.timestamp} — ${a.agentName}: ${a.description}`,
              )
              .join("\n");

      return { success: true, data: alerts, humanReadable };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur Wazuh: ${error}` };
    }
  },
};

register(searchWazuhAlerts);
