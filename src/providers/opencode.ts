import { OpenAIProvider } from "./openai.js";

export interface OpenCodeProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenCodeProvider extends OpenAIProvider {
  constructor(config: OpenCodeProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://opencode.ai/zen/v1",
    });
  }
}
