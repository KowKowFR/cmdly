import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { ProxmoxClient } from "@/lib/proxmox";

export const getVmStatus: Tool = {
  name: "get_vm_status",
  description:
    "Retourne le statut détaillé d'une VM Proxmox (CPU, mémoire, uptime) à partir de son vmid.",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({
    vmid: z.number().int().positive(),
  }),

  async execute(params, ctx) {
    const { vmid } = params as { vmid: number };
    try {
      const client = new ProxmoxClient(ctx.config);
      const status = await client.getVmStatus(vmid);

      const memPct =
        status.maxmem > 0
          ? ((status.mem / status.maxmem) * 100).toFixed(1)
          : "?";
      const cpuPct = (status.cpu * 100).toFixed(1);

      const humanReadable = [
        `VM #${vmid} — ${status.status}`,
        `  CPU: ${cpuPct}%`,
        `  RAM: ${Math.round(status.mem / 1_048_576)} MB / ${Math.round(status.maxmem / 1_048_576)} MB (${memPct}%)`,
        `  Uptime: ${formatUptime(status.uptime)}`,
      ].join("\n");

      return { success: true, data: status, humanReadable };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur: ${error}` };
    }
  },
};

register(getVmStatus);

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
