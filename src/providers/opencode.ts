import type { LLMClient, ChatOptions, ChatResponse, StreamChunk } from "./types.js";
import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";

export interface OpenCodeProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

function stripPrefix(model: string): string {
  return model.replace(/^opencode\//, "");
}

export class OpenCodeProvider implements LLMClient {
  private _delegate: OpenAIProvider;

  constructor(config: OpenCodeProviderConfig) {
    this._delegate = new OpenAIProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://opencode.ai/zen/v1",
    });
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    return this._delegate.chat({
      ...options,
      model: stripPrefix(options.model),
    });
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
    yield* this._delegate.stream({
      ...options,
      model: stripPrefix(options.model),
    });
  }

  async getCapabilities(model: string): Promise<ModelCapabilities> {
    return this._delegate.getCapabilities(stripPrefix(model));
  }
}
