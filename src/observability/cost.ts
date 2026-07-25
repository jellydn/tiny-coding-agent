/**
 * Cost estimation.
 *
 * Computes an estimated USD cost from normalized token usage and model pricing.
 * The result is always labeled as an estimate — it is not billing data.
 */

import { getPricing } from "./pricing.js";
import type { TokenUsage } from "./token-usage.js";

export interface CostEstimate {
	/** Estimated total cost in USD. */
	estimatedCostUsd: number;
	/** Breakdown in USD per component. */
	breakdown: {
		inputCostUsd: number;
		outputCostUsd: number;
		cachedCostUsd: number;
	};
	/** Always true — the value is an estimate, not a billed amount. */
	estimate: true;
}

const PER_MILLION = 1_000_000;

/**
 * Estimate the USD cost of a single LLM call.
 *
 * - Cached input tokens are priced at the cached rate when available, and
 *   subtracted from the regular input token count so they are not double-counted.
 * - When usage data is unavailable, returns a zero-cost estimate rather than
 *   silently inventing numbers.
 */
export function estimateCost(usage: TokenUsage | undefined, model: string): CostEstimate {
	const pricing = getPricing(model);

	const inputTokens = usage?.inputTokens ?? 0;
	const outputTokens = usage?.outputTokens ?? 0;
	const cachedTokens = usage?.cachedTokens ?? 0;

	// Non-cached input tokens are billed at the full rate.
	const billableInputTokens = Math.max(0, inputTokens - cachedTokens);

	const inputCostUsd = (billableInputTokens / PER_MILLION) * pricing.inputPerMillionTokens;
	const outputCostUsd = (outputTokens / PER_MILLION) * pricing.outputPerMillionTokens;
	const cachedCostUsd =
		pricing.cachedInputPerMillionTokens !== undefined
			? (cachedTokens / PER_MILLION) * pricing.cachedInputPerMillionTokens
			: 0;

	return {
		estimatedCostUsd: roundTo(inputCostUsd + outputCostUsd + cachedCostUsd, 6),
		breakdown: {
			inputCostUsd: roundTo(inputCostUsd, 6),
			outputCostUsd: roundTo(outputCostUsd, 6),
			cachedCostUsd: roundTo(cachedCostUsd, 6),
		},
		estimate: true,
	};
}

function roundTo(n: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(n * factor) / factor;
}
