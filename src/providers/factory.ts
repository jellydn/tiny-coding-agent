import type { ProviderConfig } from "../config/schema.js";
import type { LLMClient } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { OllamaCloudProvider } from "./ollama-cloud.js";
import { OpenRouterProvider } from "./openrouter.js";
import { OpenCodeProvider } from "./opencode.js";
import { ZaiProvider } from "./zai.js";
import { getCachedOllamaModels } from "./ollama-models.js";
import { detectProvider, type ProviderType } from "./model-registry.js";

export interface ModelAndProvider {
  model: string;
  provider?: ProviderType;
}

/**
 * Parse a model string in the format "model" or "model@provider"
 * Examples:
 *   "glm-4.7-flash" -> { model: "glm-4.7-flash", provider: undefined }
 *   "glm-4.7-flash@ollama" -> { model: "glm-4.7-flash", provider: "ollama" }
 *   "gpt-4o@openai" -> { model: "gpt-4o", provider: "openai" }
 */
export function parseModelString(modelString: string): ModelAndProvider {
  const atIndex = modelString.lastIndexOf("@");
  if (atIndex > 0) {
    // Has @ delimiter - explicit provider specified
    const model = modelString.slice(0, atIndex);
    const provider = modelString.slice(atIndex + 1) as ProviderType;
    return { model, provider };
  }
  // No @ - just model name, provider will be auto-detected
  return { model: modelString, provider: undefined };
}

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
    zai?: ProviderConfig;
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
  zai: { class: ZaiProvider as ProviderClass<LLMClient>, requiresApiKey: true },
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

  // Parse model string to extract explicit provider if specified (e.g., "glm-4.7-flash@ollama")
  const { model: modelName, provider: explicitProvider } = parseModelString(model);

  // Use explicit provider from model string, or from options, or auto-detect
  let providerType = explicitProvider ?? provider;

  if (!providerType) {
    const localOllamaModels = getCachedOllamaModels();
    const isLocalOllamaModel = localOllamaModels.some((m) => m.id === modelName);

    if (isLocalOllamaModel) {
      providerType = "ollama";
    } else {
      try {
        providerType = detectProvider(modelName);
      } catch {
        throw new Error(
          `Unable to detect provider for model "${modelName}". Please specify a provider explicitly using "model@provider" format. ` +
            `Examples: "glm-4.7-flash@ollama", "gpt-4o@openai", "claude-opus-4@anthropic"`,
        );
      }
    }
  }

  return createProviderInstance(providerType, providers[providerType as keyof typeof providers]);
}

// Re-export detectProvider for backwards compatibility
export { detectProvider, type ProviderType };
