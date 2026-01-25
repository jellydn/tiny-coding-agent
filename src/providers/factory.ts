import type { ProviderConfig } from "../config/schema.js";
import type { LLMClient } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OllamaCloudProvider } from "./ollama-cloud.js";
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
    ollamaCloud?: ProviderConfig;
    openrouter?: ProviderConfig;
    opencode?: ProviderConfig;
  };
}

type ProviderClass<T> = new (config: { apiKey?: string; baseUrl?: string }) => T;

const PROVIDER_MAP: Record<string, { class: ProviderClass<LLMClient>; requiresApiKey: boolean }> = {
  openai: { class: OpenAIProvider as ProviderClass<LLMClient>, requiresApiKey: true },
  anthropic: { class: AnthropicProvider as ProviderClass<LLMClient>, requiresApiKey: true },
  ollama: { class: OllamaProvider as ProviderClass<LLMClient>, requiresApiKey: false },
  ollamaCloud: { class: OllamaCloudProvider as ProviderClass<LLMClient>, requiresApiKey: true },
  openrouter: { class: OpenRouterProvider as ProviderClass<LLMClient>, requiresApiKey: true },
  opencode: { class: OpenCodeProvider as ProviderClass<LLMClient>, requiresApiKey: true },
};

function createProviderInstance<T extends LLMClient>(
  providerType: string,
  config: ProviderConfig | undefined,
): T {
  const providerInfo = PROVIDER_MAP[providerType];
  if (!providerInfo) {
    throw new Error(`Unsupported provider type: ${providerType}`);
  }

  if (providerInfo.requiresApiKey && !config?.apiKey) {
    throw new Error(`${providerType} provider requires apiKey in config`);
  }

  return new providerInfo.class({
    apiKey: config?.apiKey,
    baseUrl: config?.baseUrl,
  }) as T;
}

export function createProvider(options: CreateProviderOptions): LLMClient {
  const { model, provider, providers } = options;
  const providerType = provider ?? detectProvider(model);

  return createProviderInstance(providerType, providers[providerType as keyof typeof providers]);
}

// Re-export detectProvider for backwards compatibility
export { detectProvider, type ProviderType };
