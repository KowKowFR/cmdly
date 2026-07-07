"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatToolCall, ToolCallStatus } from "@/hooks/useChat";

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "pending":
      return <Loader2 className="size-3.5 animate-spin text-orange" />;
    case "success":
      return <CheckCircle2 className="size-3.5 text-success" />;
    case "error":
    case "denied":
      return <XCircle className="size-3.5 text-danger" />;
  }
}

// ─── Badge ─────────────────────────────────────────────────────────────────────

interface ToolCallBadgeProps {
  toolCall: ChatToolCall;
}

export function ToolCallBadge({ toolCall }: ToolCallBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = toolCall.humanReadable !== undefined;

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 text-xs overflow-hidden">
      {/* Header row */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
        onClick={() => {
          if (hasDetail) setExpanded((e) => !e);
        }}
        disabled={!hasDetail}
      >
        <StatusIcon status={toolCall.status} />
        <span className="font-mono text-white/80 flex-1">{toolCall.name}</span>
        {hasDetail && (
          expanded
            ? <ChevronUp className="size-3 text-white/40" />
            : <ChevronDown className="size-3 text-white/40" />
        )}
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && hasDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/10 px-3 py-2 space-y-1.5">
              {toolCall.humanReadable !== undefined && (
                <p className="text-white/70 leading-relaxed">{toolCall.humanReadable}</p>
              )}
              {toolCall.result !== undefined && (
                <pre className="text-white/40 overflow-x-auto text-[11px] leading-snug">
                  {JSON.stringify(toolCall.result, null, 2)}
                </pre>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
