import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { interpolateObject } from "../../src/config/config-env.js";

const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
	delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
	if (originalAnthropicApiKey === undefined) {
		delete process.env.ANTHROPIC_API_KEY;
	} else {
		process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
	}
});

describe("interpolateObject", () => {
	it("interpolates a nested API key", () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

		expect(interpolateObject({ providers: { anthropic: { apiKey: `\${ANTHROPIC_API_KEY}` } } })).toEqual({
			providers: { anthropic: { apiKey: "test-anthropic-key" } },
		});
	});

	it("throws when a referenced environment variable is missing", () => {
		expect(() => interpolateObject(`\${ANTHROPIC_API_KEY}`)).toThrow(
			"Environment variable ANTHROPIC_API_KEY is not set"
		);
	});

	it("leaves strings without placeholders unchanged", () => {
		expect(interpolateObject("plain text")).toBe("plain text");
	});

	it("interpolates placeholders in arrays", () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key";

		expect(interpolateObject(["plain", `\${ANTHROPIC_API_KEY}`])).toEqual(["plain", "test-anthropic-key"]);
	});

	it("preserves numbers, booleans, and null", () => {
		expect(interpolateObject({ count: 2, enabled: true, value: null })).toEqual({
			count: 2,
			enabled: true,
			value: null,
		});
	});
});
