import { describe, expect, it } from "bun:test";
import { buildThinkingConfig } from "../../src/providers/anthropic.js";

describe("buildThinkingConfig()", () => {
	it("should return undefined when disabled", () => {
		expect(buildThinkingConfig(false)).toBeUndefined();
	});

	it("should return config with default budget when enabled without budget", () => {
		const result = buildThinkingConfig(true);
		expect(result).toEqual({
			type: "enabled" as const,
			budget_tokens: 2000,
		});
	});

	it("should return config with custom budget when specified", () => {
		const result = buildThinkingConfig(true, 5000);
		expect(result).toEqual({
			type: "enabled" as const,
			budget_tokens: 5000,
		});
	});

	it("should return config with budget_tokens as 0 when explicitly passed", () => {
		const result = buildThinkingConfig(true, 0);
		expect(result).toEqual({
			type: "enabled" as const,
			budget_tokens: 0,
		});
	});
});
