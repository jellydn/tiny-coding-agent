import type { ModelCapabilities } from "./capabilities.js";
import { OpenAIProvider } from "./openai.js";
import { capabilitiesWithCatalogFallback } from "./provider-utils.js";

export interface OpenRouterProviderConfig {
	apiKey: string;
	baseUrl?: string;
}

/**
 * OpenRouter is an OpenAI-compatible routing layer that fronts models from
 * many underlying providers (anthropic, google, meta, mistralai, deepseek,
 * etc.). Inherits chat(), stream(), and tool-call buffering from
 * `OpenAIProvider` with the OpenRouter base URL.
 *
 * `getCapabilities` is overridden to look up entries from the models.dev
 * catalog under the "openrouter" key, which carries proxied-upstream
 * capabilities. Falls back to the inherited openai defaults for unknown
 * models so callers still get sensible numbers (rather than 16k
 * fallbacks) when the catalog does not know a particular id.
 */
export class OpenRouterProvider extends OpenAIProvider {
	private _openrouterCapabilitiesCache = new Map<string, ModelCapabilities>();

	constructor(config: OpenRouterProviderConfig) {
		super({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl || "https://openrouter.ai/api/v1",
		});
	}

	override async getCapabilities(model: string): Promise<ModelCapabilities> {
		const cached = this._openrouterCapabilitiesCache.get(model);
		if (cached) return cached;

		const catalogCaps = capabilitiesWithCatalogFallback({
			model,
			providerType: "openrouter",
			contextWindow: 200000,
			maxOutputTokens: 4096,
		});

		if (catalogCaps.source === "catalog") {
			this._openrouterCapabilitiesCache.set(model, catalogCaps);
			return catalogCaps;
		}

		return super.getCapabilities(model);
	}
}
