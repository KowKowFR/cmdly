import OpenAI from "openai";
import type { LLMEvent, LLMMessage, LLMTool, LLMToolCall, LLMProvider } from "../../types/llm.js";
import { logger } from "../logger.js";

// ─── Narrow types for the injectable client ───────────────────────────────────

interface OAIToolCallParam {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type OAIMessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: OAIToolCallParam[] }
  | { role: "tool"; content: string; tool_call_id: string };

interface OAIToolParam {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

interface StreamToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamDelta {
  content?: string | null;
  tool_calls?: StreamToolCallDelta[];
}

interface StreamChoice {
  delta: StreamDelta;
  finish_reason?: string | null;
}

export interface StreamChunk {
  choices: StreamChoice[];
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: OAIMessageParam[];
        tools: OAIToolParam[];
        stream: true;
      }): Promise<AsyncIterable<StreamChunk>>;
    };
  };
}

// ─── Message conversion ───────────────────────────────────────────────────────

function toOAIMessages(messages: LLMMessage[]): OAIMessageParam[] {
  return messages.map((msg): OAIMessageParam => {
    if (msg.role === "tool") {
      return { role: "tool", content: msg.content, tool_call_id: msg.toolCallId };
    }
    if ("toolCalls" in msg) {
      return {
        role: "assistant",
        content: msg.content,
        tool_calls: msg.toolCalls.map(
          (tc): OAIToolCallParam => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })
        ),
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

function toOAITools(tools: LLMTool[]): OAIToolParam[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

// ─── Accumulated tool-call fragment state ────────────────────────────────────

interface AccumulatedCall {
  id: string;
  name: string;
  args: string;
}

// ─── OpenAI provider ─────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;

  private readonly _client: OpenAIClientLike;

  constructor(apiKey: string, client?: OpenAIClientLike) {
    // If a fake client is injected (for testing), use it; otherwise construct a real one.
    this._client =
      client ?? (new OpenAI({ apiKey }) as unknown as OpenAIClientLike);
  }

  async *chatStream(params: {
    model: string;
    messages: LLMMessage[];
    tools: LLMTool[];
  }): AsyncGenerator<LLMEvent> {
    const { model, messages, tools } = params;

    try {
      const stream = await this._client.chat.completions.create({
        model,
        messages: toOAIMessages(messages),
        tools: toOAITools(tools),
        stream: true,
      });

      // Accumulate streamed tool-call argument fragments keyed by delta index.
      const accumulated = new Map<number, AccumulatedCall>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice === undefined) continue;

        const delta = choice.delta;

        // Yield content tokens immediately.
        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "token", content: delta.content };
        }

        // Accumulate tool-call fragments.
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = accumulated.get(tc.index);
            if (existing === undefined) {
              accumulated.set(tc.index, {
                id: tc.id ?? "",
                name: tc.function?.name ?? "",
                args: tc.function?.arguments ?? "",
              });
            } else {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
            }
          }
        }
      }

      // Emit one tool_call event per accumulated call (ordered by index).
      const sortedIndices = [...accumulated.keys()].sort((a, b) => a - b);
      for (const idx of sortedIndices) {
        const call = accumulated.get(idx);
        if (call === undefined) continue;

        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(call.args) as Record<string, unknown>;
        } catch (err) {
          logger.error("Failed to parse tool call arguments", {
            id: call.id,
            name: call.name,
            raw: call.args,
          });
          yield {
            type: "error",
            message: `Failed to parse arguments for tool call ${call.name}: ${err instanceof Error ? err.message : String(err)}`,
          };
          continue;
        }

        const toolCall: LLMToolCall = {
          id: call.id,
          name: call.name,
          arguments: parsedArgs,
        };

        yield { type: "tool_call", call: toolCall };
      }

      yield { type: "done" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("OpenAI chatStream error", { err: message });
      yield { type: "error", message };
    }
  }
}
