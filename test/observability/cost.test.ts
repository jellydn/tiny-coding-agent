import { describe, expect, it } from "bun:test";
import { estimateCost } from "../../src/observability/cost.js";
import { getPricing } from "../../src/observability/pricing.js";

describe("cost calculation", () => {
	it("computes input + output cost correctly for gpt-4o", () => {
		// gpt-4o: $2.5/M input, $10/M output
		const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, "gpt-4o");
		expect(cost.estimate).toBe(true);
		expect(cost.estimatedCostUsd).toBe(2.5 + 5);
		expect(cost.breakdown.inputCostUsd).toBe(2.5);
		expect(cost.breakdown.outputCostUsd).toBe(5);
	});

	it("prices cached tokens at the cached rate and does not double count", () => {
		// gpt-4o cached: $1.25/M. 200k input of which 50k cached.
		const cost = estimateCost({ inputTokens: 200_000, outputTokens: 0, cachedTokens: 50_000 }, "gpt-4o");
		// billable input = 150k @ 2.5/M = 0.375 ; cached 50k @ 1.25/M = 0.0625
		expect(cost.breakdown.inputCostUsd).toBe(0.375);
		expect(cost.breakdown.cachedCostUsd).toBe(0.0625);
		expect(cost.estimatedCostUsd).toBe(0.4375);
	});

	it("returns zero cost when usage data is missing", () => {
		const cost = estimateCost(undefined, "gpt-4o");
		expect(cost.estimatedCostUsd).toBe(0);
	});

	it("falls back to default pricing for unknown models", () => {
		const p = getPricing("some-unknown-model-xyz");
		expect(p.inputPerMillionTokens).toBeGreaterThan(0);
		const cost = estimateCost({ inputTokens: 1_000_000, outputTokens: 0 }, "some-unknown-model-xyz");
		expect(cost.estimatedCostUsd).toBe(p.inputPerMillionTokens);
	});

	it("strips provider prefix and @suffix when resolving pricing", () => {
		expect(getPricing("openai/gpt-4o").outputPerMillionTokens).toBe(10);
		expect(getPricing("gpt-4o@openai").outputPerMillionTokens).toBe(10);
	});

	it("matches by prefix for dated model variants", () => {
		// gpt-4o-2024-08-06 should resolve to gpt-4o pricing
		expect(getPricing("gpt-4o-2024-08-06").outputPerMillionTokens).toBe(10);
	});
});
