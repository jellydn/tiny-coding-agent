/**
 * provider-utils.ts — shared helpers for LLM provider implementations.
 *
 * Extracted during Round 7 architecture deepening to eliminate the
 * duplicated `num()` helper, token-usage construction patterns, and
 * capabilities-caching + catalog fallback pattern that were replicated
 * across 4+ provider files.
 *
 * Each helper is small and independently testable. Providers import
 * what they need rather than inheriting a deep base class.
 */

import type { ModelCapabilities } from "./capabilities.js";
import { getModelCapabilitiesFromCatalog } from "./models-dev.js";
import type { TokenUsage } from "./types.js";

/**
 * Safely extract a finite number from an unknown value.
 * Used by every provider to normalize API-specific token counts.
 */
export function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Options for building a TokenUsage from provider-specific field names.
 * Every provider returns token counts under different keys; this helper
 * normalises them into the shared TokenUsage shape.
 */
export interface TokenUsageFields {
	input?: number | undefined;
	output?: number | undefined;
	cached?: number | undefined;
	reasoning?: number | undefined;
}

/**
 * Build a normalized TokenUsage from extracted field values.
 * Returns undefined when no field has a value (provider didn't return usage).
 */
export function buildTokenUsage(fields: TokenUsageFields): TokenUsage | undefined {
	const { input, output, cached, reasoning } = fields;
	if (input === undefined && output === undefined) return undefined;
	return {
		inputTokens: input,
		outputTokens: output,
		totalTokens: input !== undefined && output !== undefined ? input + output : undefined,
		cachedTokens: cached && cached > 0 ? cached : undefined,
		reasoningTokens: reasoning && reasoning > 0 ? reasoning : undefined,
	};
}

// ─── Capabilities helpers ────────────────────────────────────────────────

/**
 * Options for {@link capabilitiesWithCatalogFallback}.
 */
export interface CapabilitiesFallbackOptions {
	model: string;
	providerType: string;
	contextWindow: number;
	maxOutputTokens: number;
	hasThinking?: boolean;
	supportsToolStreaming?: boolean;
}

/**
 * Build a ModelCapabilities object by consulting the models.dev catalog
 * first, then falling back to the supplied defaults.
 *
 * This is the common getCapabilities() pattern used by AnthropicProvider,
 * OpenAIProvider, ZaiProvider, and OpenRouterProvider — all four have
 * identical caching + catalog-lookup + fallback logic.
 *
 * @returns The catalog entry when found, or a fallback object constructed
 *          from the supplied defaults when the model is unknown.
 */
export function capabilitiesWithCatalogFallback(opts: CapabilitiesFallbackOptions): ModelCapabilities {
	const catalogCapabilities = getModelCapabilitiesFromCatalog(opts.model, opts.providerType);
	if (catalogCapabilities) {
		return catalogCapabilities;
	}

	return {
		modelName: opts.model,
		supportsTools: true,
		supportsStreaming: true,
		supportsSystemPrompt: true,
		supportsToolStreaming: opts.supportsToolStreaming ?? true,
		supportsThinking: opts.hasThinking ?? false,
		contextWindow: opts.contextWindow,
		maxOutputTokens: opts.maxOutputTokens,
		isVerified: false,
		source: "fallback",
	};
}
