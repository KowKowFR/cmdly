"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AuditFilters } from "@/lib/audit-query";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  initialFilters: AuditFilters;
}

// ─── AuditFilters component ───────────────────────────────────────────────────

export default function AuditFiltersComponent({ initialFilters }: Props) {
  const router = useRouter();

  const [userId, setUserId] = useState(initialFilters.userId ?? "");
  const [toolName, setToolName] = useState(initialFilters.toolName ?? "");
  const [result, setResult] = useState<string>(initialFilters.result ?? "all");
  const [from, setFrom] = useState(initialFilters.from ?? "");
  const [to, setTo] = useState(initialFilters.to ?? "");

  function handleApply() {
    const params = new URLSearchParams();
    if (userId.trim()) params.set("userId", userId.trim());
    if (toolName.trim()) params.set("toolName", toolName.trim());
    if (result && result !== "all") params.set("result", result);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    // Reset to page 1 when filters change
    const qs = params.toString();
    router.push(`/audit${qs ? `?${qs}` : ""}`);
  }

  function handleReset() {
    setUserId("");
    setToolName("");
    setResult("all");
    setFrom("");
    setTo("");
    router.push("/audit");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {/* User filter */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-userId"
            className="text-xs font-medium text-white/60 uppercase tracking-wide"
          >
            Utilisateur (ID)
          </label>
          <Input
            id="audit-userId"
            type="text"
            placeholder="ID utilisateur"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        {/* Tool filter */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-toolName"
            className="text-xs font-medium text-white/60 uppercase tracking-wide"
          >
            Outil
          </label>
          <Input
            id="audit-toolName"
            type="text"
            placeholder="Nom de l'outil"
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
          />
        </div>

        {/* Result filter */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-result"
            className="text-xs font-medium text-white/60 uppercase tracking-wide"
          >
            Résultat
          </label>
          <Select value={result} onValueChange={(v) => setResult(v ?? "all")}>
            <SelectTrigger
              id="audit-result"
              className="w-full bg-white/5 border-white/10 text-white"
            >
              <SelectValue placeholder="Tous" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous</SelectItem>
              <SelectItem value="success">Succès</SelectItem>
              <SelectItem value="error">Erreur</SelectItem>
              <SelectItem value="denied">Refusé</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* From date */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-from"
            className="text-xs font-medium text-white/60 uppercase tracking-wide"
          >
            Depuis
          </label>
          <Input
            id="audit-from"
            type="date"
            value={from ? from.slice(0, 10) : ""}
            onChange={(e) => setFrom(e.target.value ? `${e.target.value}T00:00:00Z` : "")}
            className="bg-white/5 border-white/10 text-white"
          />
        </div>

        {/* To date */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="audit-to"
            className="text-xs font-medium text-white/60 uppercase tracking-wide"
          >
            Jusqu'au
          </label>
          <Input
            id="audit-to"
            type="date"
            value={to ? to.slice(0, 10) : ""}
            onChange={(e) => setTo(e.target.value ? `${e.target.value}T23:59:59Z` : "")}
            className="bg-white/5 border-white/10 text-white"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleApply} size="sm">
          Appliquer
        </Button>
        <button
          type="button"
          onClick={handleReset}
          className="text-sm text-white/50 hover:text-white/80 underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
