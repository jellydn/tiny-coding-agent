import type { ModelCapabilities } from "./capabilities.js";
import { supportsThinking as modelRegistrySupportsThinking } from "./model-registry.js";
import type { OpenAIProviderConfig } from "./openai.js";
import { OpenAIProvider } from "./openai.js";
import { capabilitiesWithCatalogFallback } from "./provider-utils.js";

export interface ZaiProviderConfig {
	apiKey?: string;
	baseUrl?: string;
}

const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/";

/**
 * Zai (z.ai / Zhipu) is an OpenAI-compatible endpoint with a different base
 * URL and its own per-model context-window fallback. Inherits chat(), stream()
 * and the tool-call buffering from `OpenAIProvider`; only `getCapabilities`
 * carries zai-specific behavior (catalog lookup keyed under "zai", then a
 * hardcoded GLM-4.x context-window map as a final fallback).
 */
export class ZaiProvider extends OpenAIProvider {
	private _zaiCapabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: ZaiProviderConfig) {
		super({
			apiKey: config.apiKey ?? "",
			baseUrl: config.baseUrl ?? ZAI_BASE_URL,
		} satisfies OpenAIProviderConfig);
	}

	override async getCapabilities(model: string): Promise<ModelCapabilities> {
		const cached = this._zaiCapabilitiesCache.get(model);
		if (cached) return cached;

		const catalogCaps = capabilitiesWithCatalogFallback({
			model,
			providerType: "zai",
			contextWindow: 16385,
			maxOutputTokens: 4096,
		});

		if (catalogCaps.source === "catalog") {
			this._zaiCapabilitiesCache.set(model, catalogCaps);
			return catalogCaps;
		}

		const modelContextWindow: Record<string, number> = {
			"glm-4.7": 128000,
			"glm-4-plus": 128000,
			"glm-4.6v": 128000,
			"glm-4.6V": 128000,
			"glm-4v": 128000,
			"glm-4-air": 128000,
			"glm-4-flash": 128000,
			"glm-4": 128000,
			"glm-3-turbo": 16385,
		};

		const hasThinking = modelRegistrySupportsThinking(model);

		const caps: ModelCapabilities = {
			modelName: model,
			supportsTools: true,
			supportsStreaming: true,
			supportsSystemPrompt: true,
			supportsToolStreaming: true,
			supportsThinking: hasThinking,
			contextWindow: modelContextWindow[model] ?? 16385,
			maxOutputTokens: hasThinking ? 100000 : 4096,
			isVerified: false,
			source: "fallback",
		};

		this._zaiCapabilitiesCache.set(model, caps);
		return caps;
	}
}
