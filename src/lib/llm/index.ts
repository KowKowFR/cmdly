import type { InfrastructureConfig } from "../config.js";
import type { LLMProvider } from "../../types/llm.js";
import { OpenAIProvider } from "./openai.js";

export type { LLMProvider };
export type { LLMMessage, LLMTool, LLMToolCall, LLMToolResult, LLMEvent } from "../../types/llm.js";

/**
 * Returns the LLMProvider implementation for the given provider name.
 * Reads API keys and model from the decrypted InfrastructureConfig.
 *
 * Note: Only "openai" is implemented in this task.
 * "anthropic" and "ollama" are wired in Task 17.
 */
export function getProvider(
  name: "openai" | "anthropic" | "ollama",
  cfg: InfrastructureConfig
): LLMProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider(cfg.openaiApiKey);

    case "anthropic":
      throw new Error("provider not yet implemented: anthropic");

    case "ollama":
      throw new Error("provider not yet implemented: ollama");
  }
}
