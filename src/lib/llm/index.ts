import type { InfrastructureConfig } from "../config";
import type { LLMProvider } from "../../types/llm";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

export type { LLMProvider };
export type { LLMMessage, LLMTool, LLMToolCall, LLMToolResult, LLMEvent } from "../../types/llm";

/**
 * Returns the LLMProvider implementation for the given provider name.
 * Reads API keys and model from the decrypted InfrastructureConfig.
 */
export function getProvider(
  name: "openai" | "anthropic" | "ollama",
  cfg: InfrastructureConfig
): LLMProvider {
  switch (name) {
    case "openai":
      return new OpenAIProvider(cfg.openaiApiKey);

    case "anthropic":
      return new AnthropicProvider(cfg.anthropicApiKey, cfg.anthropicModel || undefined);

    case "ollama":
      return new OllamaProvider(cfg.ollamaBaseUrl);
  }
}
