/**
 * Model pricing configuration.
 *
 * Pricing lives in a separate JSON file (`model-pricing.json`) so it can be
 * updated without touching tracing/cost logic. All values are estimates. The
 * JSON is embedded into the compiled binary via a static import so pricing
 * works in `bun build --compile` output; set `TINY_AGENT_PRICING_CONFIG` to
 * load a different file from disk at runtime instead.
 */
import { readFileSync } from "node:fs";
import embeddedPricing from "./model-pricing.json" with { type: "json" };

/** Per-model USD pricing per 1,000,000 tokens. */
export interface ModelPricing {
	/** USD per 1M input (prompt) tokens. */
	inputPerMillionTokens: number;
	/** USD per 1M output (completion) tokens. */
	outputPerMillionTokens: number;
	/** USD per 1M cached input tokens, when the model supports prompt caching. */
	cachedInputPerMillionTokens?: number;
}

interface PricingFile {
	version: number;
	models: Record<string, ModelPricing>;
	default: ModelPricing;
}

/** Path to an override pricing config on disk, if any. */
export const PRICING_CONFIG_PATH = process.env.TINY_AGENT_PRICING_CONFIG;

let cached: PricingFile | undefined;
let cachedPath: string | undefined;

/**
 * Load and cache the pricing config. Uses the embedded JSON by default; when
 * `TINY_AGENT_PRICING_CONFIG` is set, reads that file from disk instead.
 */
export function loadPricingConfig(path: string | undefined = PRICING_CONFIG_PATH): PricingFile {
	if (path) {
		if (cached && path === cachedPath) return cached;
		const content = readFileSync(path, "utf-8");
		const parsed = JSON.parse(content) as PricingFile;
		cached = parsed;
		cachedPath = path;
		return parsed;
	}
	// Default: embedded pricing (works in the compiled binary too).
	return embeddedPricing as PricingFile;
}

/** Allow tests to reset the cache after writing a temp config. */
export function resetPricingCache(): void {
	cached = undefined;
	cachedPath = undefined;
}

/**
 * Resolve pricing for a model. Falls back to the file's `default` entry, then
 * to a zero-cost sentinel, so cost calculation never throws on unknown models.
 */
export function getPricing(model: string): ModelPricing {
	try {
		const config = loadPricingConfig();
		// Strip provider prefix (e.g. "openai/gpt-4o" -> "gpt-4o") and the
		// "@provider" suffix used by the model string format.
		const normalized = model
			.replace(/^[^/]+\//, "")
			.split("@")[0]!
			.toLowerCase();
		return (
			config.models[normalized] ??
			// Try a prefix match so "gpt-4o-2024-08-06" resolves to "gpt-4o".
			matchByPrefix(config.models, normalized) ??
			config.default
		);
	} catch {
		return { inputPerMillionTokens: 0, outputPerMillionTokens: 0 };
	}
}

function matchByPrefix(models: Record<string, ModelPricing>, model: string): ModelPricing | undefined {
	// Longest key that is a prefix of the model name.
	let best: { key: string; pricing: ModelPricing } | undefined;
	for (const [key, pricing] of Object.entries(models)) {
		if (model.startsWith(key) && (!best || key.length > best.key.length)) {
			best = { key, pricing };
		}
	}
	return best?.pricing;
}
