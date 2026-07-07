import { Ollama } from "ollama";
import { randomUUID } from "node:crypto";
import type { LLMEvent, LLMMessage, LLMTool, LLMProvider } from "../../types/llm";
import { logger } from "../logger";

// ─── Narrow types for the injectable client ───────────────────────────────────

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaMessageParam {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolParam {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaChunk {
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
}

export interface OllamaClientLike {
  chat(params: {
    model: string;
    messages: OllamaMessageParam[];
    tools?: OllamaToolParam[];
    stream: true;
  }): Promise<AsyncIterable<OllamaChunk>>;
}

// ─── Message conversion ───────────────────────────────────────────────────────

function toOllamaMessages(messages: LLMMessage[]): OllamaMessageParam[] {
  return messages.map((msg): OllamaMessageParam => {
    if (msg.role === "tool") {
      // Ollama tool results: drop toolCallId, just pass content
      return { role: "tool", content: msg.content };
    }
    if ("toolCalls" in msg) {
      // Assistant message with tool calls
      return {
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

function toOllamaTools(tools: LLMTool[]): OllamaToolParam[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// ─── OllamaProvider ───────────────────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama" as const;

  private readonly _client: OllamaClientLike;

  constructor(baseUrl: string, client?: OllamaClientLike) {
    this._client =
      client ?? (new Ollama({ host: baseUrl }) as unknown as OllamaClientLike);
  }

  async *chatStream(params: {
    model: string;
    messages: LLMMessage[];
    tools: LLMTool[];
  }): AsyncGenerator<LLMEvent> {
    const { model, messages, tools } = params;

    try {
      const stream = await this._client.chat({
        model,
        messages: toOllamaMessages(messages),
        ...(tools.length > 0 ? { tools: toOllamaTools(tools) } : {}),
        stream: true,
      });

      // Collect tool calls that appear across any chunk (Ollama typically delivers them complete, not fragmented).
      const collectedToolCalls: OllamaToolCall[] = [];

      for await (const chunk of stream) {
        // Yield text tokens immediately.
        if (chunk.message.content && chunk.message.content.length > 0) {
          yield { type: "token", content: chunk.message.content };
        }

        // Collect tool calls (may appear in any chunk).
        if (chunk.message.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            collectedToolCalls.push(tc);
          }
        }
      }

      // Emit one tool_call event per collected call.
      // Ollama does not provide tool call IDs, so we generate them.
      for (const tc of collectedToolCalls) {
        yield {
          type: "tool_call",
          call: {
            id: randomUUID(),
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        };
      }

      yield { type: "done" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Ollama chatStream error", { err: message });
      yield { type: "error", message };
    }
  }
}
