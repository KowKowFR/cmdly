import { getConfig } from "@/lib/config";
import { ProxmoxClient } from "@/lib/proxmox";
import { logger } from "@/lib/logger";
import { VMCard } from "@/components/dashboard/VMCard";
import { FadeInSection } from "@/components/dashboard/FadeInSection";
import type { ProxmoxVm } from "@/lib/proxmox";

// ─── Status summary counts ────────────────────────────────────────────────────

function summarise(vms: ProxmoxVm[]) {
  const running = vms.filter((v) => v.status === "running").length;
  const stopped = vms.filter((v) => v.status === "stopped").length;
  const other = vms.length - running - stopped;
  return { running, stopped, other };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function VmsPage() {
  let vms: ProxmoxVm[] = [];
  let error: string | null = null;

  try {
    const cfg = await getConfig();
    if (!cfg.proxmoxHost) {
      error = "Proxmox non configuré — rendez-vous dans les paramètres.";
    } else {
      const client = new ProxmoxClient(cfg);
      vms = await client.listVms();
    }
  } catch (err) {
    error = "Impossible de contacter Proxmox.";
    logger.warn("vms page: listVms failed", { err: String(err) });
  }

  const { running, stopped, other } = summarise(vms);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">
          Machines virtuelles
        </h1>
        <p className="text-white/50 text-sm mt-1">
          Inventaire Proxmox — toutes les VMs
        </p>
      </div>

      {/* Summary pills */}
      {!error && vms.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {running} en ligne
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {stopped} arrêtée{stopped !== 1 ? "s" : ""}
          </span>
          {other > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              {other} autre{other !== 1 ? "s" : ""}
            </span>
          )}
          <span className="text-xs text-white/30 ml-1">
            Total : {vms.length} VM{vms.length !== 1 ? "s" : ""}
          </span>
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
              Configurer Proxmox →
            </a>
          </div>
        </FadeInSection>
      ) : vms.length === 0 ? (
        <FadeInSection>
          <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center">
            <p className="text-white/50 text-sm">Aucune VM trouvée.</p>
          </div>
        </FadeInSection>
      ) : (
        <FadeInSection delay={0.1}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {vms.map((vm) => (
              <VMCard key={vm.vmid} vm={vm} />
            ))}
          </div>
        </FadeInSection>
      )}
    </div>
  );
}
