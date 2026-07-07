"use client";

import { useState, useCallback } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PendingConfirmation } from "@/hooks/useChat";

interface ConfirmDialogProps {
  confirmation: PendingConfirmation;
  onConfirm: (toolCallId: string, typed?: string) => Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ confirmation, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);

  const requiresTyping = confirmation.requireTyping !== undefined;
  const typingMatches = !requiresTyping || typed === confirmation.requireTyping;

  const handleConfirm = useCallback(async () => {
    if (!typingMatches || loading) return;
    setLoading(true);
    try {
      await onConfirm(confirmation.toolCallId, requiresTyping ? typed : undefined);
    } finally {
      setLoading(false);
    }
  }, [confirmation.toolCallId, typingMatches, loading, onConfirm, requiresTyping, typed]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false} className="max-w-md bg-[#0D1B2A] border-white/15">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-danger flex-shrink-0" />
            <DialogTitle className="text-white">Action irréversible</DialogTitle>
          </div>
          <DialogDescription className="text-white/60">
            Cette opération nécessite votre confirmation explicite.
          </DialogDescription>
        </DialogHeader>

        {/* Action details */}
        <div className="space-y-3">
          <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 space-y-2">
            <p className="text-xs font-mono text-danger font-medium">{confirmation.action}</p>
            {Object.keys(confirmation.params).length > 0 && (
              <pre className="text-xs text-white/60 overflow-x-auto">
                {JSON.stringify(confirmation.params, null, 2)}
              </pre>
            )}
          </div>

          <p className="text-sm text-warning/90 font-medium">
            ⚠️ Cette action peut être irréversible. Vérifiez les paramètres avant de continuer.
          </p>

          {/* Typed confirmation input */}
          {requiresTyping && (
            <div className="space-y-1.5">
              <p className="text-xs text-white/60">
                Pour confirmer, saisissez exactement :{" "}
                <code className="font-mono text-white/80 bg-white/10 px-1 py-0.5 rounded">
                  {confirmation.requireTyping}
                </code>
              </p>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmation.requireTyping}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-orange/50"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={!typingMatches || loading}
          >
            {loading ? "Exécution…" : "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
