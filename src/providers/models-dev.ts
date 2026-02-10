import { providersCatalog } from "@tokenlens/models";
import type { ModelCapabilities } from "./capabilities.js";

/**
 * Capability source indicates where the capability information came from
 */
export type CapabilitySource = "api" | "catalog" | "fallback";

/**
 * Extended model capabilities with source tracking
 */
export interface ModelsDevCapabilities extends ModelCapabilities {
	source: CapabilitySource;
}

/**
 * Map provider type to models.dev provider ID
 */
const PROVIDER_MAP: Record<string, string> = {
	openai: "openai",
	anthropic: "anthropic",
	ollama: "ollama", // Not in models.dev, will use fallback
	ollamaCloud: "ollama", // Not in models.dev, will use fallback
	openrouter: "openrouter",
	opencode: "opencode",
	zai: "zai",
};

/**
 * Get model capabilities from models.dev catalog
 * Returns null if model is not found in catalog
 */
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
		supportsSystemPrompt: !modelData.reasoning, // Reasoning models often don't support system prompts
		supportsToolStreaming: modelData.tool_call ?? false,
		supportsThinking: modelData.reasoning ?? false,
		contextWindow: modelData.limit?.context,
		maxOutputTokens: modelData.limit?.output,
		isVerified: undefined, // Will be set by caller based on source
		source: "catalog",
	};

	return capabilities;
}

/**
 * Check if a model exists in the models.dev catalog
 */
export function isModelInCatalog(model: string, providerType: string): boolean {
	return getModelCapabilitiesFromCatalog(model, providerType) !== null;
}

/**
 * Get all models for a provider from the catalog
 */
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
