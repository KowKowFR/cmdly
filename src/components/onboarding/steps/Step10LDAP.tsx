"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step10LDAP({ formData, updateData, errors }: StepProps) {
  const ldapEnabled = Boolean(formData.ldapEnabled);

  const field = (key: string, label: string, opts?: { type?: string; placeholder?: string; hint?: string }) => (
    <div className="space-y-1.5">
      <Label htmlFor={key} className="text-slate-300">{label}</Label>
      <Input
        id={key}
        type={opts?.type ?? "text"}
        placeholder={opts?.placeholder}
        value={String(formData[key] ?? "")}
        onChange={(e) => updateData({ [key]: e.target.value })}
        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
      />
      {opts?.hint && <p className="text-xs text-slate-500">{opts.hint}</p>}
      {errors[key] && <p className="text-xs text-red-400">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <Users className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Authentification LDAP</h2>
        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">Optionnel</Badge>
      </div>
      <p className="text-sm text-slate-400">
        Activez l'authentification LDAP/Active Directory pour permettre aux utilisateurs de votre annuaire de se connecter.
      </p>

      <div className="flex items-center gap-3">
        <Switch
          checked={ldapEnabled}
          onCheckedChange={(checked) => updateData({ ldapEnabled: checked })}
        />
        <Label className="text-slate-300 cursor-pointer">
          {ldapEnabled ? "LDAP activé" : "LDAP désactivé"}
        </Label>
      </div>

      {ldapEnabled && (
        <div className="space-y-4 pt-2">
          {field("ldapUrl", "URL du serveur LDAP", {
            placeholder: "ldap://dc.exemple.fr:389",
            hint: "ldap:// ou ldaps:// pour TLS",
          })}
          {field("ldapBindDn", "Bind DN", { placeholder: "cn=cmdly,ou=services,dc=exemple,dc=fr" })}
          {field("ldapBindPassword", "Mot de passe Bind", { type: "password", placeholder: "••••••••" })}
          {field("ldapBaseDn", "Base DN", { placeholder: "ou=users,dc=exemple,dc=fr" })}
        </div>
      )}

      {errors.ldapUrl && ldapEnabled && <p className="text-xs text-red-400">{errors.ldapUrl}</p>}
    </div>
  );
}
