import { OpenAIProvider } from "./openai.js";

export interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * OpenRouter provider - aggregates models from multiple providers
 * @see https://openrouter.ai/docs
 *
 * OpenRouter provides an OpenAI-compatible API that aggregates models from
 * various providers (Anthropic, Google, Meta, Mistral AI, etc.).
 *
 * Models are prefixed with provider names (e.g., "anthropic/claude-3.5-sonnet")
 * or use the "openrouter/" prefix.
 */
export class OpenRouterProvider extends OpenAIProvider {
  constructor(config: OpenRouterProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
    });
  }
}
