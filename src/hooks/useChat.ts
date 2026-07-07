"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolCallStatus = "pending" | "success" | "error" | "denied";

export interface ChatToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
  humanReadable?: string;
  result?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ChatToolCall[];
  streaming: boolean;
}

export interface PendingConfirmation {
  toolCallId: string;
  action: string;
  params: Record<string, unknown>;
  requireTyping?: string;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingConfirmation: PendingConfirmation | null;
  conversationId: string | null;
  sendMessage: (text: string) => Promise<void>;
  confirm: (toolCallId: string, typed?: string) => Promise<void>;
  cancelConfirm: () => void;
  startNewConversation: () => void;
}

// ─── Tiny local ID helper (no crypto in client bundle) ────────────────────────

function localId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChat(initialConversationId?: string): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null
  );

  const esRef = useRef<EventSource | null>(null);

  // Clean up EventSource on unmount
  // (called inline — no useEffect needed in the hook itself; the component should
  //  call startNewConversation or rely on the ES closing on done/error events)

  const closeES = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      // Close any in-flight stream
      closeES();

      // Optimistically add user message
      const userMsgId = localId();
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: trimmed, toolCalls: [], streaming: false },
      ]);
      setIsStreaming(true);

      // Create a placeholder assistant message
      const assistantMsgId = localId();

      try {
        // 1. POST to create run
        const postRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: trimmed }),
        });

        if (!postRes.ok) {
          throw new Error(`Échec de la création du flux : ${postRes.status}`);
        }

        const { streamId, conversationId: newConvId } = (await postRes.json()) as {
          streamId: string;
          conversationId: string;
        };

        setConversationId(newConvId);

        // Add streaming assistant placeholder
        setMessages((prev) => [
          ...prev,
          { id: assistantMsgId, role: "assistant", content: "", toolCalls: [], streaming: true },
        ]);

        // 2. Open EventSource for SSE stream
        const es = new EventSource(`/api/chat/stream?streamId=${streamId}`);
        esRef.current = es;

        es.addEventListener("token", (e: Event) => {
          if (!(e instanceof MessageEvent)) return;
          const { content } = JSON.parse(e.data as string) as { content: string };
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + content }
                : msg
            )
          );
        });

        es.addEventListener("tool_call", (e: Event) => {
          if (!(e instanceof MessageEvent)) return;
          const data = JSON.parse(e.data as string) as {
            id: string;
            name: string;
            status: ToolCallStatus;
          };
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    toolCalls: [
                      ...msg.toolCalls,
                      { id: data.id, name: data.name, status: "pending" },
                    ],
                  }
                : msg
            )
          );
        });

        es.addEventListener("tool_result", (e: Event) => {
          if (!(e instanceof MessageEvent)) return;
          const data = JSON.parse(e.data as string) as {
            id: string;
            status: ToolCallStatus;
            humanReadable: string;
            result?: unknown;
          };
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    toolCalls: msg.toolCalls.map((tc) =>
                      tc.id === data.id
                        ? {
                            ...tc,
                            status: data.status,
                            humanReadable: data.humanReadable,
                            result: data.result,
                          }
                        : tc
                    ),
                  }
                : msg
            )
          );
        });

        es.addEventListener("confirm_required", (e: Event) => {
          if (!(e instanceof MessageEvent)) return;
          const data = JSON.parse(e.data as string) as PendingConfirmation;
          setPendingConfirmation(data);
        });

        const finalize = () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, streaming: false } : msg
            )
          );
          setIsStreaming(false);
          es.close();
          esRef.current = null;
        };

        es.addEventListener("done", finalize);

        // Handle both: server-sent `event: error` messages AND connection errors
        es.addEventListener("error", (e: Event) => {
          finalize();
          if (e instanceof MessageEvent) {
            // Server emitted an SSE error event — message is in e.data
            try {
              const { message: errMsg } = JSON.parse(e.data as string) as {
                message: string;
              };
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: msg.content || `Erreur : ${errMsg}` }
                    : msg
                )
              );
            } catch {
              // ignore parse failure
            }
          }
        });
      } catch (err) {
        // Network / fetch error before SSE opened
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: `Erreur : ${err instanceof Error ? err.message : String(err)}`,
                  streaming: false,
                }
              : msg
          )
        );
        setIsStreaming(false);
      }
    },
    [conversationId, isStreaming, closeES]
  );

  const confirm = useCallback(
    async (toolCallId: string, typed?: string) => {
      if (!conversationId || !pendingConfirmation) return;

      try {
        const res = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, toolCallId, confirmed: true, typed }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? `Erreur ${res.status}`);
        }

        const data = (await res.json()) as {
          status: ToolCallStatus;
          humanReadable: string;
          result?: unknown;
        };

        // Merge result into the tool call badge
        setMessages((prev) =>
          prev.map((msg) => ({
            ...msg,
            toolCalls: msg.toolCalls.map((tc) =>
              tc.id === toolCallId
                ? {
                    ...tc,
                    status: data.status,
                    humanReadable: data.humanReadable,
                    result: data.result,
                  }
                : tc
            ),
          }))
        );

        setPendingConfirmation(null);
      } catch (err) {
        // Surface error to user — keep the confirm dialog open so they can retry
        toast.error(
          `Échec de la confirmation : ${err instanceof Error ? err.message : "erreur inconnue"}`
        );
      }
    },
    [conversationId, pendingConfirmation]
  );

  const cancelConfirm = useCallback(() => {
    setPendingConfirmation(null);
  }, []);

  const startNewConversation = useCallback(() => {
    closeES();
    setMessages([]);
    setIsStreaming(false);
    setPendingConfirmation(null);
    setConversationId(null);
  }, [closeES]);

  return {
    messages,
    isStreaming,
    pendingConfirmation,
    conversationId,
    sendMessage,
    confirm,
    cancelConfirm,
    startNewConversation,
  };
}
