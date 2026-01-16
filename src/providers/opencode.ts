import { OpenAIProvider } from "./openai.js";

export interface OpenCodeProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * OpenCode Zen provider - curated list of tested and verified models
 * @see https://opencode.ai/docs/zen/
 *
 * OpenCode Zen provides an OpenAI-compatible API with a curated list of
 * models tested and verified for coding agent use cases.
 *
 * Models use the "opencode/" prefix (e.g., "opencode/gpt-5.2-codex").
 */
export class OpenCodeProvider extends OpenAIProvider {
  constructor(config: OpenCodeProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://opencode.ai/zen/v1",
    });
  }
}
