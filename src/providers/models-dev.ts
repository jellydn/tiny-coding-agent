import { providersCatalog } from "@tokenlens/models";
import type { ModelCapabilities } from "./capabilities.js";

export type CapabilitySource = "api" | "catalog" | "fallback";

export interface ModelsDevCapabilities extends ModelCapabilities {
	source: CapabilitySource;
}

const PROVIDER_MAP: Record<string, string> = {
	openai: "openai",
	anthropic: "anthropic",
	ollama: "ollama",
	ollamaCloud: "ollama",
	openrouter: "openrouter",
	zai: "zai",
};

export function getModelCapabilitiesFromCatalog(model: string, providerType: string): ModelsDevCapabilities | null {
	const catalogProviderId = PROVIDER_MAP[providerType];
	if (!catalogProviderId) {
		return null;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Need to dynamically index the catalog
	const provider = (providersCatalog as Record<string, any>)[catalogProviderId];
	if (!provider) {
		return null;
	}

	// Try exact match first
	let modelData = provider.models[model];

	// If not found, try without provider prefix (e.g., "glm-4.5-flash" from "zai/glm-4.5-flash")
	if (!modelData && model.includes("/")) {
		const modelWithoutPrefix = model.split("/").pop();
		if (modelWithoutPrefix) {
			modelData = provider.models[modelWithoutPrefix];
		}
	}

	if (!modelData) {
		return null;
	}

	// Map models.dev schema to our ModelCapabilities
	const capabilities: ModelsDevCapabilities = {
		modelName: model,
		supportsTools: modelData.tool_call ?? false,
		supportsStreaming: true, // Assume streaming is supported by default
		supportsSystemPrompt: true, // Default to supported; let provider-specific overrides narrow
		supportsToolStreaming: modelData.tool_call ?? false,
		supportsThinking: modelData.reasoning ?? false,
		contextWindow: modelData.limit?.context ?? 16385, // Default fallback
		maxOutputTokens: modelData.limit?.output ?? 4096, // Default fallback
		isVerified: false, // Catalog data is not API-verified
		source: "catalog",
	};

	return capabilities;
}

export function isModelInCatalog(model: string, providerType: string): boolean {
	return getModelCapabilitiesFromCatalog(model, providerType) !== null;
}

export function getProviderModels(providerType: string): string[] {
	const catalogProviderId = PROVIDER_MAP[providerType];
	if (!catalogProviderId) {
		return [];
	}

	// biome-ignore lint/suspicious/noExplicitAny: Need to dynamically index the catalog
	const provider = (providersCatalog as Record<string, any>)[catalogProviderId];
	if (!provider) {
		return [];
	}

	return Object.keys(provider.models);
}
