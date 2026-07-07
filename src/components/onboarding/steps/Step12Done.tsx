"use client";

import { CheckCircle2 } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step12Done({ formData: _f, updateData: _u, errors: _e }: StepProps) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="rounded-full bg-blue-500/10 p-6 ring-2 ring-blue-500/20">
          <CheckCircle2 className="w-12 h-12 text-blue-400" />
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-white">Configuration terminée !</h2>
        <p className="text-slate-400 max-w-sm mx-auto">
          CMDLY est prêt. Votre infrastructure est configurée et l'IA est opérationnelle.
        </p>
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-left space-y-2 max-w-sm mx-auto">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Ce qui est activé</p>
        <ul className="space-y-1.5 text-sm text-slate-300">
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            Gestion Proxmox VE
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            Assistant IA (chat infrastructure)
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            Exécution Ansible / Terraform
          </li>
          <li className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            Audit et traçabilité des actions
          </li>
        </ul>
      </div>

      <p className="text-xs text-slate-500">
        Cliquez sur <span className="text-slate-300 font-medium">Accéder au dashboard</span> pour commencer.
      </p>
    </div>
  );
}
