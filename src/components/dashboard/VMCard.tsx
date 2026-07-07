import { Card, CardContent } from "@/components/ui/card";
import type { ProxmoxVm } from "@/lib/proxmox";

function statusDot(status: string): { color: string; label: string } {
  switch (status.toLowerCase()) {
    case "running":
      return { color: "bg-green-500", label: "En ligne" };
    case "stopped":
      return { color: "bg-red-500", label: "Arrêtée" };
    case "paused":
      return { color: "bg-amber-500", label: "En pause" };
    default:
      return { color: "bg-amber-400", label: status || "Inconnu" };
  }
}

function fmtMem(bytes: number): string {
  if (bytes <= 0) return "—";
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} Go` : `${Math.round(bytes / 1024 / 1024)} Mo`;
}

function fmtUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${mins} min`;
  return `${mins} min`;
}

interface VMCardProps {
  vm: ProxmoxVm;
}

export function VMCard({ vm }: VMCardProps) {
  const { color, label } = statusDot(vm.status);

  return (
    <Card className="h-full">
      <CardContent className="pt-4">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color}`}
          />
          <span className="font-semibold text-white text-sm truncate">
            {vm.name || `VM ${vm.vmid}`}
          </span>
        </div>

        {/* Details */}
        <dl className="space-y-1 text-xs text-white/50">
          <div className="flex justify-between">
            <dt>VMID</dt>
            <dd className="text-white/70 tabular-nums">{vm.vmid}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Statut</dt>
            <dd className="text-white/70">{label}</dd>
          </div>
          <div className="flex justify-between">
            <dt>CPU</dt>
            <dd className="text-white/70 tabular-nums">{vm.cpus} vCPU</dd>
          </div>
          <div className="flex justify-between">
            <dt>RAM</dt>
            <dd className="text-white/70 tabular-nums">{fmtMem(vm.maxmem)}</dd>
          </div>
          {vm.uptime > 0 && (
            <div className="flex justify-between">
              <dt>Uptime</dt>
              <dd className="text-white/70">{fmtUptime(vm.uptime)}</dd>
            </div>
          )}
          {vm.ip && (
            <div className="flex justify-between">
              <dt>IP</dt>
              <dd className="text-white/70 font-mono">{vm.ip}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
