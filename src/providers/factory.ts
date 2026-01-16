import type { ProviderConfig } from "../config/schema.js";
import type { LLMClient } from "./types.js";
import { OpenAIProvider, type OpenAIProviderConfig } from "./openai.js";
import { AnthropicProvider, type AnthropicProviderConfig } from "./anthropic.js";
import { OllamaProvider, type OllamaProviderConfig } from "./ollama.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OpenCodeProvider } from "./opencode.js";
import { detectProvider, type ProviderType } from "./model-registry.js";

export interface CreateProviderOptions {
  model: string;
  provider?: ProviderType;
  providers: {
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    ollama?: ProviderConfig;
    openrouter?: ProviderConfig;
    opencode?: ProviderConfig;
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
        apiKey: config.apiKey,
      } satisfies OllamaProviderConfig);
    }

    case "openrouter": {
      const config = providers.openrouter;
      if (!config?.apiKey) {
        throw new Error("OpenRouter provider requires apiKey in config");
      }
      return new OpenRouterProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    }

    case "opencode": {
      const config = providers.opencode;
      if (!config?.apiKey) {
        throw new Error("OpenCode provider requires apiKey in config");
      }
      return new OpenCodeProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    }

    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

// Re-export detectProvider for backwards compatibility
export { detectProvider, type ProviderType };
