import { OpenAIProvider } from "./openai.js";

export interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenRouterProvider extends OpenAIProvider {
  constructor(config: OpenRouterProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
    });
  }
}
