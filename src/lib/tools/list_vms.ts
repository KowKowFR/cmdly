import { z } from "zod";
import type { Tool } from "@/types/tools";
import { register } from "./registry";
import { ProxmoxClient, type FetchFn } from "@/lib/proxmox";
import type { InfrastructureConfig } from "@/lib/config";
import type { ProxmoxVm } from "@/lib/proxmox";

// ─── Injectable factory (overridable in tests) ────────────────────────────────

interface VmLister {
  listVms(): Promise<ProxmoxVm[]>;
}

type ClientFactory = (cfg: InfrastructureConfig, fetchFn?: FetchFn) => VmLister;

let _clientFactory: ClientFactory = (cfg) => new ProxmoxClient(cfg);

/** Override the ProxmoxClient factory — for unit tests only. */
export function setClientFactory(f: ClientFactory): void {
  _clientFactory = f;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const listVms: Tool = {
  name: "list_vms",
  description:
    "Liste toutes les VMs Proxmox avec statut, RAM, CPU et uptime.",
  category: "read",
  requiredRole: "viewer",
  parameters: z.object({}),

  async execute(_params, ctx) {
    try {
      const client = _clientFactory(ctx.config);
      const vms = await client.listVms();

      const humanReadable =
        vms.length === 0
          ? "Aucune VM trouvée."
          : vms
              .map(
                (v) =>
                  `- ${v.name} (#${v.vmid}) — ${v.status} | CPU: ${v.cpus} | RAM: ${Math.round(v.maxmem / 1_048_576)} MB`,
              )
              .join("\n");

      return { success: true, data: vms, humanReadable };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, humanReadable: `Erreur: ${error}` };
    }
  },
};

register(listVms);
