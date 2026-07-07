import Anthropic from "@anthropic-ai/sdk";
import type { LLMEvent, LLMMessage, LLMTool, LLMProvider } from "../../types/llm";
import { logger } from "../logger";

// ─── Default model ────────────────────────────────────────────────────────────
// claude-opus-4-8 is the current recommended default from the claude-api skill.

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 4096;

// ─── Narrow types for the injectable client ───────────────────────────────────

type AntUserContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string };

type AntAssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type AntMessageParam =
  | { role: "user"; content: string | AntUserContentBlock[] }
  | { role: "assistant"; content: string | AntAssistantContentBlock[] };

interface AntToolParam {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// Stream event discriminated union — only the shapes we actually process.
type AntRawEvent =
  | { type: "message_start"; message: Record<string, unknown> }
  | { type: "content_block_start"; index: number; content_block: { type: "text" } | { type: "tool_use"; id: string; name: string } }
  | { type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: Record<string, unknown> }
  | { type: "message_stop" };

export interface AnthropicClientLike {
  messages: {
    stream(params: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: AntMessageParam[];
      tools?: AntToolParam[];
    }): AsyncIterable<AntRawEvent>;
  };
}

// ─── Message conversion ───────────────────────────────────────────────────────

function toAnthropic(messages: LLMMessage[]): {
  system: string | undefined;
  messages: AntMessageParam[];
} {
  let system: string | undefined;
  const result: AntMessageParam[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    // System messages go into the top-level `system` param (Anthropic requires this).
    if (msg.role === "system") {
      system = msg.content;
      i++;
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
      i++;
      continue;
    }

    if (msg.role === "assistant" && "toolCalls" in msg) {
      // Assistant message that triggered tool calls.
      const content: AntAssistantContentBlock[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      result.push({ role: "assistant", content });
      i++;
      continue;
    }

    if (msg.role === "assistant") {
      result.push({ role: "assistant", content: msg.content });
      i++;
      continue;
    }

    if (msg.role === "tool") {
      // Group consecutive tool-result messages into one user turn.
      const toolResults: AntUserContentBlock[] = [];
      while (i < messages.length) {
        const cur = messages[i]!;
        if (cur.role !== "tool") break;
        toolResults.push({
          type: "tool_result",
          tool_use_id: cur.toolCallId,
          content: cur.content,
        });
        i++;
      }
      result.push({ role: "user", content: toolResults });
      continue;
    }

    // Unknown role — skip.
    i++;
  }

  return { system, messages: result };
}

function toAntTools(tools: LLMTool[]): AntToolParam[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ─── Accumulated tool-call state ──────────────────────────────────────────────

interface AccumulatedToolUse {
  id: string;
  name: string;
  jsonFragments: string;
}

// ─── AnthropicProvider ────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;

  private readonly _client: AnthropicClientLike;
  private readonly _defaultModel: string;

  constructor(apiKey: string, model?: string, client?: AnthropicClientLike) {
    // Use the injected fake client for tests; otherwise construct a real one.
    this._client =
      client ?? (new Anthropic({ apiKey }) as unknown as AnthropicClientLike);
    this._defaultModel = model || DEFAULT_MODEL;
  }

  async *chatStream(params: {
    model: string;
    messages: LLMMessage[];
    tools: LLMTool[];
  }): AsyncGenerator<LLMEvent> {
    const model = params.model || this._defaultModel;
    const { system, messages } = toAnthropic(params.messages);
    const tools = toAntTools(params.tools);

    try {
      const stream = this._client.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        ...(system !== undefined ? { system } : {}),
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      });

      // tool_use blocks: accumulate per content-block index.
      const toolBlocks = new Map<number, AccumulatedToolUse>();

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const cb = event.content_block;
          if (cb.type === "tool_use") {
            toolBlocks.set(event.index, {
              id: cb.id,
              name: cb.name,
              jsonFragments: "",
            });
          }
          // text blocks: no action needed at start.
        } else if (event.type === "content_block_delta") {
          const delta = event.delta;

          if (delta.type === "text_delta") {
            // Emit text token immediately.
            if (delta.text.length > 0) {
              yield { type: "token", content: delta.text };
            }
          } else if (delta.type === "input_json_delta") {
            // Accumulate JSON fragments for the current tool_use block.
            const block = toolBlocks.get(event.index);
            if (block !== undefined) {
              block.jsonFragments += delta.partial_json;
            }
          }
        } else if (event.type === "content_block_stop") {
          // Finalise a tool_use block: parse and emit.
          const block = toolBlocks.get(event.index);
          if (block !== undefined) {
            toolBlocks.delete(event.index);
            // A no-argument tool (e.g. list_vms with an empty schema) may stream
            // no input_json_delta at all, leaving jsonFragments empty. Treat that
            // as an empty argument object rather than a parse error.
            const rawJson = block.jsonFragments.trim() === "" ? "{}" : block.jsonFragments;
            let parsedInput: Record<string, unknown>;
            try {
              parsedInput = JSON.parse(rawJson) as Record<string, unknown>;
            } catch (err) {
              logger.error("Failed to parse Anthropic tool_use input JSON", {
                id: block.id,
                name: block.name,
                raw: block.jsonFragments,
              });
              yield {
                type: "error",
                message: `Failed to parse arguments for tool call ${block.name}: ${err instanceof Error ? err.message : String(err)}`,
              };
              continue;
            }

            yield {
              type: "tool_call",
              call: {
                id: block.id,
                name: block.name,
                arguments: parsedInput,
              },
            };
          }
        }
        // message_start, message_delta, message_stop: no action needed.
      }

      yield { type: "done" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Anthropic chatStream error", { err: message });
      yield { type: "error", message };
    }
  }
}
