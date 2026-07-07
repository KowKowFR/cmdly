"use client";

import { motion } from "framer-motion";
import { ToolCallBadge } from "./ToolCallBadge";
import type { ChatMessage } from "@/hooks/useChat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        {(message.content.length > 0 || message.streaming) && (
          <div
            className={
              isUser
                ? "rounded-2xl rounded-tr-sm bg-orange/20 border border-orange/30 px-4 py-2.5 text-sm text-white/90"
                : "rounded-2xl rounded-tl-sm bg-white/8 border border-white/10 px-4 py-2.5 text-sm text-white/90"
            }
          >
            {/* Preserve newlines but don't render markdown */}
            <span className="whitespace-pre-wrap">{message.content}</span>
            {message.streaming && message.content.length === 0 && (
              <span className="inline-block h-4 w-0.5 animate-pulse bg-orange/70 ml-0.5" />
            )}
            {message.streaming && message.content.length > 0 && (
              <span className="inline-block h-4 w-0.5 animate-pulse bg-orange/70 ml-0.5 align-middle" />
            )}
          </div>
        )}

        {/* Tool call badges */}
        {message.toolCalls.length > 0 && (
          <div className="w-full space-y-1.5 mt-1">
            {message.toolCalls.map((tc) => (
              <ToolCallBadge key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
