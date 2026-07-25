import { describe, expect, it } from "bun:test";
import {
	fromAnthropicUsage,
	fromOllamaUsage,
	fromOpenAIUsage,
	fromUnknownUsage,
	isUsageUnavailable,
	mergeUsage,
	NO_USAGE,
} from "../../src/observability/token-usage.js";

describe("token-usage", () => {
	describe("fromOpenAIUsage", () => {
		it("maps prompt/completion/total and cached/reasoning details", () => {
			const u = fromOpenAIUsage({
				prompt_tokens: 100,
				completion_tokens: 50,
				total_tokens: 150,
				prompt_tokens_details: { cached_tokens: 20 },
				completion_tokens_details: { reasoning_tokens: 5 },
			});
			expect(u).toEqual({
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150,
				cachedTokens: 20,
				reasoningTokens: 5,
			});
		});
		it("returns NO_USAGE for empty input", () => {
			expect(isUsageUnavailable(fromOpenAIUsage(undefined))).toBe(true);
		});
	});

	describe("fromAnthropicUsage", () => {
		it("maps input/output and derives total, sums cache reads+creations", () => {
			const u = fromAnthropicUsage({
				input_tokens: 80,
				output_tokens: 40,
				cache_read_input_tokens: 15,
				cache_creation_input_tokens: 5,
			});
			expect(u.inputTokens).toBe(80);
			expect(u.outputTokens).toBe(40);
			expect(u.totalTokens).toBe(120);
			expect(u.cachedTokens).toBe(20);
		});
	});

	describe("fromOllamaUsage", () => {
		it("maps prompt_eval_count / eval_count", () => {
			const u = fromOllamaUsage({ prompt_eval_count: 30, eval_count: 12 });
			expect(u).toEqual({ inputTokens: 30, outputTokens: 12, totalTokens: 42 });
		});
	});

	describe("fromUnknownUsage", () => {
		it("falls through OpenAI -> Anthropic -> Ollama shapes", () => {
			expect(fromUnknownUsage({ prompt_tokens: 1, completion_tokens: 2 }).inputTokens).toBe(1);
			expect(fromUnknownUsage({ input_tokens: 3, output_tokens: 4 }).inputTokens).toBe(3);
			expect(fromUnknownUsage({ prompt_eval_count: 5 }).inputTokens).toBe(5);
			expect(isUsageUnavailable(fromUnknownUsage({ unrelated: true }))).toBe(true);
		});
	});

	describe("mergeUsage", () => {
		it("sums defined fields and recomputes total", () => {
			const merged = mergeUsage({ inputTokens: 10, outputTokens: 5 }, { inputTokens: 20, outputTokens: 15 });
			expect(merged.inputTokens).toBe(30);
			expect(merged.outputTokens).toBe(20);
			expect(merged.totalTokens).toBe(50);
		});
		it("treats undefined as absent, not zero, for missing fields", () => {
			const merged = mergeUsage({ inputTokens: 10 }, { outputTokens: 5 });
			expect(merged.inputTokens).toBe(10);
			expect(merged.outputTokens).toBe(5);
			expect(merged.totalTokens).toBe(15);
		});
	});

	describe("isUsageUnavailable", () => {
		it("treats NO_USAGE and empty objects as unavailable", () => {
			expect(isUsageUnavailable(NO_USAGE)).toBe(true);
			expect(isUsageUnavailable(undefined)).toBe(true);
			expect(isUsageUnavailable({})).toBe(true);
			expect(isUsageUnavailable({ inputTokens: 1 })).toBe(false);
		});
	});
});
