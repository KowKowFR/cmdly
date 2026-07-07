"use client";

import { useState, useRef, useCallback } from "react";
import { SendHorizonal } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  return (
    <div className="flex-shrink-0 border-t border-white/10 bg-[#0D1B2A] px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 focus-within:border-orange/50 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Traitement en cours…" : "Posez votre question…"}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50 leading-6 max-h-[200px] overflow-y-auto"
        />
        <button
          onClick={handleSend}
          disabled={disabled || value.trim() === ""}
          className="flex-shrink-0 rounded-lg p-1.5 text-orange hover:bg-orange/15 disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <SendHorizonal className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-center text-[11px] text-white/20">
        Entrée pour envoyer · Maj+Entrée pour nouvelle ligne
      </p>
    </div>
  );
}
