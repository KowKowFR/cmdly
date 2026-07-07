"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Server, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step03Proxmox({ formData, updateData, errors }: StepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/onboarding/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "proxmox", data: formData }),
      });
      const json = await res.json() as { ok: boolean; message: string };
      setTestResult(json);
    } catch {
      setTestResult({ ok: false, message: "Erreur réseau" });
    } finally {
      setTesting(false);
    }
  }

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
        <Server className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Connexion Proxmox VE</h2>
      </div>
      <p className="text-sm text-slate-400">
        Configurez l'accès à votre cluster Proxmox via l'API REST.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          {field("proxmoxHost", "Hôte / IP", { placeholder: "192.168.1.10" })}
        </div>
        <div className="col-span-2 sm:col-span-1">
          {field("proxmoxPort", "Port", { placeholder: "8006", hint: "Défaut : 8006" })}
        </div>
      </div>

      {field("proxmoxUser", "Utilisateur", { placeholder: "root@pam", hint: "Format : user@realm" })}
      {field("proxmoxNode", "Nœud", { placeholder: "pve" })}
      {field("proxmoxTokenId", "Token ID", { placeholder: "mytoken" })}
      {field("proxmoxTokenSecret", "Token Secret", { type: "password", placeholder: "••••••••" })}

      <div className="pt-2 space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleTest}
          disabled={testing}
          className="border-slate-600 text-slate-300 hover:bg-slate-800"
        >
          {testing ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Test en cours…</>
          ) : (
            "Tester la connexion"
          )}
        </Button>
        {testResult && (
          <div className={`flex items-center gap-2 text-sm ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
