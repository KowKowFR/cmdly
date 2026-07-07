"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step06Vault({ formData, updateData, errors }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <Lock className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Ansible Vault</h2>
      </div>
      <p className="text-sm text-slate-400">
        Fichier contenant le mot de passe utilisé pour chiffrer/déchiffrer les variables Ansible Vault.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="ansibleVaultPasswordFile" className="text-slate-300">
          Chemin du fichier de mot de passe
        </Label>
        <Input
          id="ansibleVaultPasswordFile"
          type="text"
          placeholder="/etc/cmdly/.vault_pass"
          value={String(formData.ansibleVaultPasswordFile ?? "")}
          onChange={(e) => updateData({ ansibleVaultPasswordFile: e.target.value })}
          className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
        />
        <p className="text-xs text-slate-500">
          Ce fichier doit être lisible par le processus CMDLY. Permissions recommandées : 600.
        </p>
        {errors.ansibleVaultPasswordFile && (
          <p className="text-xs text-red-400">{errors.ansibleVaultPasswordFile}</p>
        )}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-xs text-slate-400">
        <p className="font-medium text-slate-300 mb-1">Création rapide :</p>
        <code className="font-mono text-blue-300">echo "mon_mot_de_passe" &gt; /etc/cmdly/.vault_pass && chmod 600 /etc/cmdly/.vault_pass</code>
      </div>
    </div>
  );
}
