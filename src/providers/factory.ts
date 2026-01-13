import type { ProviderConfig } from "../config/schema.js";
import type { LLMClient } from "./types.js";
import { OpenAIProvider, type OpenAIProviderConfig } from "./openai.js";
import { AnthropicProvider, type AnthropicProviderConfig } from "./anthropic.js";
import { OllamaProvider, type OllamaProviderConfig } from "./ollama.js";

export interface CreateProviderOptions {
  model: string;
  provider?: "openai" | "anthropic" | "ollama";
  providers: {
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    ollama?: ProviderConfig;
  };
}

export function createProvider(options: CreateProviderOptions): LLMClient {
  const { model, provider, providers } = options;

  const providerType = provider ?? detectProvider(model);

  switch (providerType) {
    case "openai": {
      const config = providers.openai;
      if (!config?.apiKey) {
        throw new Error("OpenAI provider requires apiKey in config");
      }
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      } satisfies OpenAIProviderConfig);
    }

    case "anthropic": {
      const config = providers.anthropic;
      if (!config?.apiKey) {
        throw new Error("Anthropic provider requires apiKey in config");
      }
      return new AnthropicProvider({
        apiKey: config.apiKey,
      } satisfies AnthropicProviderConfig);
    }

    case "ollama": {
      const config = providers.ollama ?? {};
      return new OllamaProvider({
        baseUrl: config.baseUrl,
      } satisfies OllamaProviderConfig);
    }

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

function detectProvider(model: string): "openai" | "anthropic" | "ollama" {
  const modelLower = model.toLowerCase();

  if (modelLower.startsWith("gpt-")) {
    return "openai";
  }

  if (modelLower.startsWith("claude-")) {
    return "anthropic";
  }

  return "ollama";
}
