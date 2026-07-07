// ─── Shared LLM contract ──────────────────────────────────────────────────────

export type LLMMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: LLMToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  content: string;
}

export type LLMEvent =
  | { type: "token"; content: string }
  | { type: "tool_call"; call: LLMToolCall }
  | { type: "done" }
  | { type: "error"; message: string };

export interface LLMProvider {
  name: "openai" | "anthropic" | "ollama";
  chatStream(params: {
    model: string;
    messages: LLMMessage[];
    tools: LLMTool[];
  }): AsyncGenerator<LLMEvent>;
}
