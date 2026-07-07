import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { messages as messagesTable } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { executeTool } from "@/lib/tools/executor";
import { toolCatalogueForLLM } from "@/lib/tools/registry";
import { storePendingConfirmation } from "@/lib/chat/runStore";
import { logger } from "@/lib/logger";
import type { ExecutionContext } from "@/types/tools";
import type { LLMProvider, LLMMessage, LLMToolCall } from "@/types/llm";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT =
  "Tu es CMDLY, un assistant d'infrastructure intelligent. " +
  "Tu aides les administrateurs système à gérer leur infrastructure " +
  "Proxmox, Zabbix, Wazuh et services Linux. " +
  "Utilise les outils disponibles pour répondre précisément aux demandes. " +
  "Réponds en français. Sois concis et professionnel.";

// ─── Dependency injection ─────────────────────────────────────────────────────

type PersistMsg = {
  conversationId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LLMToolCall[] | null;
  toolCallId?: string | null;
};

type ExecuteToolFn = (
  name: string,
  rawParams: unknown,
  ctx: ExecutionContext,
  opts?: { confirmed?: boolean }
) => ReturnType<typeof executeTool>;

type PersistFn = (msg: PersistMsg) => Promise<string>;
type LoadHistoryFn = (conversationId: string) => Promise<LLMMessage[]>;

export interface OrchestratorDeps {
  executeToolFn?: ExecuteToolFn;
  persistMessageFn?: PersistFn;
  loadHistoryFn?: LoadHistoryFn;
}

// ─── Default implementations ──────────────────────────────────────────────────

const defaultPersist: PersistFn = async (msg) => {
  const id = randomUUID();
  await db.insert(messagesTable).values({
    id,
    conversationId: msg.conversationId,
    role: msg.role,
    content: msg.content,
    toolCalls: msg.toolCalls ?? null,
    toolCallId: msg.toolCallId ?? null,
  });
  return id;
};

const defaultLoadHistory: LoadHistoryFn = async (conversationId) => {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt));

  return rows.map((row): LLMMessage => {
    if (row.role === "tool") {
      return {
        role: "tool",
        toolCallId: row.toolCallId ?? "",
        content: row.content,
      };
    }
    if (row.role === "assistant") {
      const toolCalls = row.toolCalls as LLMToolCall[] | null | undefined;
      if (toolCalls && toolCalls.length > 0) {
        return {
          role: "assistant",
          content: row.content || null,
          toolCalls,
        };
      }
      return { role: "assistant", content: row.content };
    }
    // "user" or "system" — schema only has user/assistant/tool but guard anyway
    return { role: "user", content: row.content };
  });
};

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Orchestrate a full conversation round-trip:
 *
 * 1. Load history from DB (or injected fn).
 * 2. Stream the LLM response, yielding SSE-style events.
 * 3. For each tool call, execute and yield results.
 * 4. Feed tool results back to the model for a follow-up round (multi-round, max 5).
 * 5. If confirm_required: store in runStore pendingConfirmations and stop the loop.
 *
 * Design: MULTI-ROUND loop — after executing tools, the model is called again
 * with tool results appended so it can summarise.  This loop repeats up to
 * MAX_TOOL_ROUNDS times.  A confirm_required outcome in any tool call stops the
 * loop immediately (after persisting the assistant message) and yields `done`.
 * The /api/tools route handles confirmation asynchronously.
 *
 * This generator NEVER throws — all errors are caught and emitted as `error` events.
 */
export async function* runConversation(
  ctx: ExecutionContext,
  conversationId: string,
  provider: LLMProvider,
  model: string,
  deps?: OrchestratorDeps
): AsyncGenerator<{ event: string; data: unknown }> {
  const execTool: ExecuteToolFn = deps?.executeToolFn ?? executeTool;
  const persist: PersistFn = deps?.persistMessageFn ?? defaultPersist;
  const loadHistory: LoadHistoryFn = deps?.loadHistoryFn ?? defaultLoadHistory;

  try {
    const tools = toolCatalogueForLLM(ctx.userRole);
    const history = await loadHistory(conversationId);

    // System prompt + full history (user message already persisted by POST)
    let messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ];

    let lastMessageId = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let accContent = "";
      const accToolCalls: LLMToolCall[] = [];
      let errorOccurred = false;

      // ── Stream provider events ──────────────────────────────────────────────
      const providerGen = provider.chatStream({ model, messages, tools });
      for await (const event of providerGen) {
        if (event.type === "token") {
          accContent += event.content;
          yield { event: "token", data: { content: event.content } };
        } else if (event.type === "tool_call") {
          accToolCalls.push(event.call);
          yield {
            event: "tool_call",
            data: { id: event.call.id, name: event.call.name, status: "pending" },
          };
        } else if (event.type === "error") {
          yield { event: "error", data: { message: event.message } };
          errorOccurred = true;
          break;
        }
        // "done" → break implicitly at generator exhaustion
      }

      if (errorOccurred) return;

      // ── Pure text response (no tool calls) — persist and finish ────────────
      if (accToolCalls.length === 0) {
        lastMessageId = await persist({
          conversationId,
          role: "assistant",
          content: accContent,
        });
        yield { event: "done", data: { messageId: lastMessageId } };
        return;
      }

      // ── Execute each tool call ──────────────────────────────────────────────
      const toolResultMsgs: LLMMessage[] = [];
      let hasConfirmRequired = false;

      for (const call of accToolCalls) {
        const outcome = await execTool(call.name, call.arguments, ctx);

        if (outcome.status === "confirm_required") {
          hasConfirmRequired = true;
          storePendingConfirmation(conversationId, call.id, {
            name: call.name,
            params: outcome.confirm.params,
            userId: ctx.userId,
            requireTyping: outcome.confirm.requireTyping,
          });
          yield {
            event: "confirm_required",
            data: {
              toolCallId: call.id,
              action: outcome.confirm.action,
              params: outcome.confirm.params,
              requireTyping: outcome.confirm.requireTyping,
            },
          };
        } else {
          const humanReadable =
            outcome.status === "success"
              ? outcome.result.humanReadable
              : outcome.reason;

          yield {
            event: "tool_result",
            data: {
              id: call.id,
              status: outcome.status,
              humanReadable,
              result: outcome.status === "success" ? outcome.result.data : undefined,
            },
          };

          // Persist tool result message
          await persist({
            conversationId,
            role: "tool",
            content: humanReadable,
            toolCallId: call.id,
          });

          // Collect for next round
          toolResultMsgs.push({
            role: "tool",
            toolCallId: call.id,
            content: humanReadable,
          });
        }
      }

      // ── Persist the assistant message (with tool calls) ─────────────────────
      lastMessageId = await persist({
        conversationId,
        role: "assistant",
        content: accContent,
        toolCalls: accToolCalls,
      });

      if (hasConfirmRequired) {
        // Stop the loop — user must confirm via POST /api/tools
        yield { event: "done", data: { messageId: lastMessageId } };
        return;
      }

      // ── Prepare messages for next round ─────────────────────────────────────
      const assistantMsg: LLMMessage = {
        role: "assistant",
        content: accContent || null,
        toolCalls: accToolCalls,
      };
      messages = [...messages, assistantMsg, ...toolResultMsgs];
    }

    // MAX_TOOL_ROUNDS exhausted without a clean done
    logger.warn("orchestrator: max tool rounds exceeded", { conversationId });
    yield { event: "done", data: { messageId: lastMessageId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("orchestrator: unexpected error", { conversationId, error: message });
    yield { event: "error", data: { message } };
  }
}
