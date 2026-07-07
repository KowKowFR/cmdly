"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step09Wazuh({ formData, updateData, errors }: StepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/onboarding/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "wazuh", data: formData }),
      });
      const json = await res.json() as { ok: boolean; message: string };
      setTestResult(json);
    } catch {
      setTestResult({ ok: false, message: "Erreur réseau" });
    } finally {
      setTesting(false);
    }
  }

  const field = (key: string, label: string, opts?: { type?: string; placeholder?: string }) => (
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
      {errors[key] && <p className="text-xs text-red-400">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <ShieldAlert className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Wazuh SIEM</h2>
        <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">Optionnel</Badge>
      </div>
      <p className="text-sm text-slate-400">
        Intégration avec Wazuh pour la corrélation des alertes de sécurité.
        Laissez vide pour ignorer cette étape.
      </p>

      {field("wazuhUrl", "URL Wazuh API", { placeholder: "https://wazuh.exemple.fr:55000" })}
      {field("wazuhUser", "Utilisateur", { placeholder: "wazuh-wui" })}
      {field("wazuhPassword", "Mot de passe", { type: "password", placeholder: "••••••••" })}

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
