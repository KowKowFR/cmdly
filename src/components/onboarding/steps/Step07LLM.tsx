"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Brain, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface StepProps {
  formData: Record<string, unknown>;
  updateData: (patch: Record<string, unknown>) => void;
  errors: Record<string, string>;
}

export function Step07LLM({ formData, updateData, errors }: StepProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const provider = String(formData.defaultLlmProvider ?? "openai");

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/onboarding/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "llm", data: formData }),
      });
      const json = await res.json() as { ok: boolean; message: string };
      setTestResult(json);
    } catch {
      setTestResult({ ok: false, message: "Erreur réseau" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <Brain className="w-5 h-5 text-blue-400" />
        <h2 className="text-xl font-semibold text-white">Fournisseur LLM</h2>
      </div>
      <p className="text-sm text-slate-400">
        Choisissez le modèle de langage qui alimentera l'assistant IA de CMDLY.
      </p>

      <div className="space-y-1.5">
        <Label className="text-slate-300">Fournisseur</Label>
        <Select
          value={provider}
          onValueChange={(v) => updateData({ defaultLlmProvider: v })}
        >
          <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder="Choisir..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
            <SelectItem value="ollama">Ollama (local)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {provider === "openai" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="openaiApiKey" className="text-slate-300">Clé API OpenAI</Label>
            <Input
              id="openaiApiKey"
              type="password"
              placeholder="sk-..."
              value={String(formData.openaiApiKey ?? "")}
              onChange={(e) => updateData({ openaiApiKey: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            {errors.openaiApiKey && <p className="text-xs text-red-400">{errors.openaiApiKey}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="openaiModel" className="text-slate-300">Modèle</Label>
            <Input
              id="openaiModel"
              type="text"
              placeholder="gpt-4o"
              value={String(formData.openaiModel ?? "gpt-4o")}
              onChange={(e) => updateData({ openaiModel: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>
        </>
      )}

      {provider === "anthropic" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="anthropicApiKey" className="text-slate-300">Clé API Anthropic</Label>
            <Input
              id="anthropicApiKey"
              type="password"
              placeholder="sk-ant-..."
              value={String(formData.anthropicApiKey ?? "")}
              onChange={(e) => updateData({ anthropicApiKey: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            {errors.anthropicApiKey && <p className="text-xs text-red-400">{errors.anthropicApiKey}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="anthropicModel" className="text-slate-300">Modèle</Label>
            <Input
              id="anthropicModel"
              type="text"
              placeholder="claude-opus-4-8"
              value={String(formData.anthropicModel ?? "claude-opus-4-8")}
              onChange={(e) => updateData({ anthropicModel: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>
        </>
      )}

      {provider === "ollama" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="ollamaBaseUrl" className="text-slate-300">URL de base Ollama</Label>
            <Input
              id="ollamaBaseUrl"
              type="url"
              placeholder="http://localhost:11434"
              value={String(formData.ollamaBaseUrl ?? "http://localhost:11434")}
              onChange={(e) => updateData({ ollamaBaseUrl: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
            {errors.ollamaBaseUrl && <p className="text-xs text-red-400">{errors.ollamaBaseUrl}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ollamaModel" className="text-slate-300">Modèle</Label>
            <Input
              id="ollamaModel"
              type="text"
              placeholder="llama3"
              value={String(formData.ollamaModel ?? "llama3")}
              onChange={(e) => updateData({ ollamaModel: e.target.value })}
              className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
            />
          </div>
        </>
      )}

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
