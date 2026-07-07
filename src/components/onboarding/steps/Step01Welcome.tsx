"use client";

import { CheckCircle2, Server, GitBranch, Terminal, Lock } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

const prerequisites = [
  { icon: Server, label: "Accès Proxmox VE (API token prêt)" },
  { icon: Terminal, label: "Node.js 20+ et Terraform installés" },
  { icon: GitBranch, label: "Ansible ≥ 2.14 installé" },
  { icon: Lock, label: "Clé SSH générée pour le bastion" },
];

export function Step01Welcome({ formData: _f, updateData: _u, errors: _e }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-white">Bienvenue sur CMDLY</h1>
        <p className="text-slate-400 text-lg max-w-md mx-auto">
          Le tableau de bord d'infrastructure piloté par IA pour les équipes cybersécurité.
        </p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 space-y-3">
        <p className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
          Prérequis avant de commencer
        </p>
        <ul className="space-y-3">
          {prerequisites.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-3 text-sm text-slate-300">
              <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
              <Icon className="w-4 h-4 text-slate-500 shrink-0" />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-slate-500 text-center">
        Cette configuration sera stockée localement et chiffrée. Cliquez sur{" "}
        <span className="text-slate-300 font-medium">Suivant</span> pour commencer.
      </p>
    </div>
  );
}
