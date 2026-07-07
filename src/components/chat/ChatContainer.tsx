"use client";

import { useEffect, useState, useRef } from "react";
import { PlusCircle, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { ConfirmDialog } from "./ConfirmDialog";
import { useChat } from "@/hooks/useChat";

interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

// ─── Conversations sidebar ─────────────────────────────────────────────────────

function ConversationSidebar({
  currentId,
  onSelect,
  onNew,
}: {
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    void fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        setConvs((data as { conversations: ConversationSummary[] }).conversations ?? []);
      })
      .catch(() => {/* ignore */});
  }, [currentId]); // refetch when conversation changes

  return (
    <div className="w-52 flex-shrink-0 flex flex-col border-r border-white/10 overflow-hidden">
      {/* New conversation */}
      <button
        onClick={onNew}
        className="flex items-center gap-2 px-3 py-2.5 text-sm text-orange hover:bg-white/5 border-b border-white/10 transition-colors font-medium"
      >
        <PlusCircle className="size-4" />
        Nouvelle conversation
      </button>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {convs.length === 0 && (
          <p className="px-3 py-4 text-xs text-white/30 text-center">
            Aucune conversation
          </p>
        )}
        {convs.map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors group ${
              conv.id === currentId ? "bg-orange/10 border-l-2 border-orange" : ""
            }`}
          >
            <MessageSquare className="size-3.5 mt-0.5 flex-shrink-0 text-white/30 group-hover:text-white/50" />
            <span className="text-xs text-white/70 group-hover:text-white/90 line-clamp-2 leading-snug">
              {conv.title ?? "Conversation"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main container ────────────────────────────────────────────────────────────

export function ChatContainer() {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);

  const {
    messages,
    isStreaming,
    pendingConfirmation,
    conversationId,
    sendMessage,
    confirm,
    cancelConfirm,
    startNewConversation,
  } = useChat(selectedConvId ?? undefined);

  // Sync conversationId back to sidebar
  const prevConvId = useRef<string | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== prevConvId.current) {
      prevConvId.current = conversationId;
      setSelectedConvId(conversationId);
    }
  }, [conversationId]);

  const handleSelectConversation = (id: string) => {
    // Re-mount with new conversationId is handled via selectedConvId → useChat
    setSelectedConvId(id);
  };

  const handleNew = () => {
    startNewConversation();
    setSelectedConvId(null);
  };

  return (
    <div className="h-full flex overflow-hidden rounded-xl border border-white/10 bg-[#0D1B2A]">
      {/* Left sidebar */}
      <ConversationSidebar
        currentId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNew}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-shrink-0 border-b border-white/10 px-4 py-3"
        >
          <h1 className="text-sm font-semibold text-white/80">
            {conversationId ? "Conversation en cours" : "CMDLY — Assistant infrastructure"}
          </h1>
          {isStreaming && (
            <p className="text-xs text-orange/70 mt-0.5">CMDLY réfléchit…</p>
          )}
        </motion.div>

        {/* Messages */}
        <MessageList messages={messages} />

        {/* Confirm dialog */}
        {pendingConfirmation && (
          <ConfirmDialog
            confirmation={pendingConfirmation}
            onConfirm={confirm}
            onCancel={cancelConfirm}
          />
        )}

        {/* Input */}
        <ChatInput onSend={(text) => void sendMessage(text)} disabled={isStreaming} />
      </div>
    </div>
  );
}
