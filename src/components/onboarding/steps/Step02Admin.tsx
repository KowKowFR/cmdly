"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step02Admin({ formData, updateData, errors }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Compte administrateur</h2>
      </div>
      <p className="text-sm text-slate-400">
        Ce compte sera le super-administrateur de CMDLY. Choisissez un mot de passe fort.
      </p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-slate-300">Nom complet</Label>
          <Input
            id="name"
            type="text"
            placeholder="Jean Dupont"
            value={String(formData.name ?? "")}
            onChange={(e) => updateData({ name: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
          {errors.name && <p className="text-xs text-red-400">{errors.name}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-slate-300">Adresse e-mail</Label>
          <Input
            id="email"
            type="email"
            placeholder="admin@organisation.fr"
            value={String(formData.email ?? "")}
            onChange={(e) => updateData({ email: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
          {errors.email && <p className="text-xs text-red-400">{errors.email}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-slate-300">Mot de passe</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••••••"
            value={String(formData.password ?? "")}
            onChange={(e) => updateData({ password: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-500">
            12 caractères minimum · majuscule · minuscule · chiffre
          </p>
          {errors.password && <p className="text-xs text-red-400">{errors.password}</p>}
        </div>
      </div>
    </div>
  );
}
