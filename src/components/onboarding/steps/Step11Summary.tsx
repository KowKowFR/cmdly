"use client";

import { ClipboardList, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
  onJumpToStep?: (step: number) => void;
}

function mask(value: unknown): string {
  const str = String(value ?? "");
  if (!str) return "(non renseigné)";
  return str;
}

function maskSecret(value: unknown): string {
  const str = String(value ?? "");
  if (!str) return "(non renseigné)";
  return "••••••••";
}

interface SectionProps {
  title: string;
  step: number;
  rows: Array<{ label: string; value: string }>;
  onEdit?: (step: number) => void;
}

function Section({ title, step, rows, onEdit }: SectionProps) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        {onEdit && (
          <Button
            variant="ghost"
            className="h-6 px-2 text-xs text-blue-400 hover:text-blue-300"
            onClick={() => onEdit(step)}
          >
            <Edit2 className="w-3 h-3 mr-1" />
            Modifier
          </Button>
        )}
      </div>
      <dl className="space-y-1">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex justify-between text-xs">
            <dt className="text-slate-400">{label}</dt>
            <dd className="text-slate-200 font-mono text-right max-w-[55%] truncate">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Step11Summary({ formData, updateData: _u, errors: _e, onJumpToStep }: StepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-1">
        <ClipboardList className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Récapitulatif</h2>
      </div>
      <p className="text-sm text-slate-400 mb-4">
        Vérifiez votre configuration avant de finaliser. Cliquez sur "Modifier" pour revenir à une étape.
      </p>

      <Section
        title="Compte administrateur"
        step={2}
        onEdit={onJumpToStep}
        rows={[
          { label: "Nom", value: mask(formData.name) },
          { label: "E-mail", value: mask(formData.email) },
          { label: "Mot de passe", value: maskSecret(formData.password) },
        ]}
      />

      <Section
        title="Proxmox VE"
        step={3}
        onEdit={onJumpToStep}
        rows={[
          { label: "Hôte", value: mask(formData.proxmoxHost) },
          { label: "Port", value: mask(formData.proxmoxPort ?? "8006") },
          { label: "Utilisateur", value: mask(formData.proxmoxUser) },
          { label: "Nœud", value: mask(formData.proxmoxNode) },
          { label: "Token ID", value: mask(formData.proxmoxTokenId) },
          { label: "Token Secret", value: maskSecret(formData.proxmoxTokenSecret) },
        ]}
      />

      <Section
        title="Dépôt d'infrastructure"
        step={4}
        onEdit={onJumpToStep}
        rows={[
          { label: "Type", value: mask(formData.infraRepoType) },
          formData.infraRepoType === "local"
            ? { label: "Chemin", value: mask(formData.infraRepoPath) }
            : { label: "URL Git", value: mask(formData.infraRepoGitUrl) },
          ...(formData.infraRepoType === "git"
            ? [{ label: "Branche", value: mask(formData.infraRepoGitBranch ?? "main") }]
            : []),
        ]}
      />

      <Section
        title="Bastion SSH"
        step={5}
        onEdit={onJumpToStep}
        rows={[
          { label: "Hôte", value: mask(formData.bastionHost) },
          { label: "Port", value: mask(formData.bastionPort ?? "22") },
          { label: "Utilisateur", value: mask(formData.bastionUser) },
          { label: "Clé SSH", value: mask(formData.sshKeyPath) },
        ]}
      />

      <Section
        title="Ansible Vault"
        step={6}
        onEdit={onJumpToStep}
        rows={[{ label: "Fichier", value: mask(formData.ansibleVaultPasswordFile) }]}
      />

      <Section
        title="LLM"
        step={7}
        onEdit={onJumpToStep}
        rows={[
          { label: "Fournisseur", value: mask(formData.defaultLlmProvider) },
          ...(formData.defaultLlmProvider === "openai"
            ? [
                { label: "Modèle", value: mask(formData.openaiModel ?? "gpt-4o") },
                { label: "Clé API", value: maskSecret(formData.openaiApiKey) },
              ]
            : formData.defaultLlmProvider === "anthropic"
            ? [
                { label: "Modèle", value: mask(formData.anthropicModel ?? "claude-opus-4-8") },
                { label: "Clé API", value: maskSecret(formData.anthropicApiKey) },
              ]
            : [
                { label: "URL", value: mask(formData.ollamaBaseUrl) },
                { label: "Modèle", value: mask(formData.ollamaModel) },
              ]),
        ]}
      />

      {Boolean(formData.zabbixUrl || formData.zabbixUser) && (
        <Section
          title="Zabbix"
          step={8}
          onEdit={onJumpToStep}
          rows={[
            { label: "URL", value: mask(formData.zabbixUrl) },
            { label: "Utilisateur", value: mask(formData.zabbixUser) },
          ]}
        />
      )}

      {Boolean(formData.wazuhUrl || formData.wazuhUser) && (
        <Section
          title="Wazuh"
          step={9}
          onEdit={onJumpToStep}
          rows={[
            { label: "URL", value: mask(formData.wazuhUrl) },
            { label: "Utilisateur", value: mask(formData.wazuhUser) },
          ]}
        />
      )}

      {Boolean(formData.ldapEnabled) && (
        <Section
          title="LDAP"
          step={10}
          onEdit={onJumpToStep}
          rows={[
            { label: "URL", value: mask(formData.ldapUrl) },
            { label: "Bind DN", value: mask(formData.ldapBindDn) },
            { label: "Base DN", value: mask(formData.ldapBaseDn) },
          ]}
        />
      )}
    </div>
  );
}
