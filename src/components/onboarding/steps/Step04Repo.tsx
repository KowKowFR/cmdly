"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step04Repo({ formData, updateData, errors }: StepProps) {
  const repoType = String(formData.infraRepoType ?? "local");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <GitBranch className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Dépôt d'infrastructure</h2>
      </div>
      <p className="text-sm text-slate-400">
        Indiquez où se trouvent vos fichiers Terraform / Ansible.
      </p>

      <div className="space-y-1.5">
        <Label className="text-slate-300">Type de dépôt</Label>
        <Select
          value={repoType}
          onValueChange={(v) => updateData({ infraRepoType: v })}
        >
          <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder="Choisir..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local (chemin système)</SelectItem>
            <SelectItem value="git">Dépôt Git distant</SelectItem>
          </SelectContent>
        </Select>
        {errors.infraRepoType && <p className="text-xs text-red-400">{errors.infraRepoType}</p>}
      </div>

      {repoType === "local" && (
        <div className="space-y-1.5">
          <Label htmlFor="infraRepoPath" className="text-slate-300">Chemin absolu</Label>
          <Input
            id="infraRepoPath"
            type="text"
            placeholder="/opt/infra"
            value={String(formData.infraRepoPath ?? "")}
            onChange={(e) => updateData({ infraRepoPath: e.target.value })}
            className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
          />
          {errors.infraRepoPath && <p className="text-xs text-red-400">{errors.infraRepoPath}</p>}
        </div>
      )}

      {repoType === "git" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="infraRepoGitUrl" className="text-slate-300">URL Git</Label>
            <Input
              id="infraRepoGitUrl"
              type="url"
              placeholder="https://github.com/org/infra.git"
              value={String(formData.infraRepoGitUrl ?? "")}
              onChange={(e) => updateData({ infraRepoGitUrl: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            {errors.infraRepoGitUrl && <p className="text-xs text-red-400">{errors.infraRepoGitUrl}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="infraRepoGitBranch" className="text-slate-300">Branche</Label>
            <Input
              id="infraRepoGitBranch"
              type="text"
              placeholder="main"
              value={String(formData.infraRepoGitBranch ?? "main")}
              onChange={(e) => updateData({ infraRepoGitBranch: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            {errors.infraRepoGitBranch && <p className="text-xs text-red-400">{errors.infraRepoGitBranch}</p>}
          </div>
        </>
      )}
    </div>
  );
}
