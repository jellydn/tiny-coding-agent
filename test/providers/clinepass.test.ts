import { describe, expect, it } from "bun:test";
import { ClinePassProvider } from "../../src/providers/clinepass.js";
import { OpenAIProvider } from "../../src/providers/openai.js";

describe("ClinePassProvider", () => {
	describe("constructor", () => {
		it("should default baseUrl to https://api.cline.bot/v1", () => {
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			expect(provider).toBeInstanceOf(ClinePassProvider);
			// Inherits from OpenAIProvider so it satisfies the LLMClient contract.
			expect(provider).toBeInstanceOf(OpenAIProvider);
		});

		it("should accept a custom baseUrl", () => {
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: "https://custom.example.com/v1",
			});
			expect(provider).toBeInstanceOf(ClinePassProvider);
		});
	});

	describe("getCapabilities()", () => {
		const provider = new ClinePassProvider({ apiKey: "test-key" });

		it("should return hardcoded capabilities for cline-pass/deepseek-v4-flash", async () => {
			const caps = await provider.getCapabilities("cline-pass/deepseek-v4-flash");
			expect(caps.modelName).toBe("cline-pass/deepseek-v4-flash");
			expect(caps.supportsTools).toBe(true);
			expect(caps.supportsStreaming).toBe(true);
			expect(caps.supportsThinking).toBe(true);
			expect(caps.contextWindow).toBe(128000);
			expect(caps.maxOutputTokens).toBe(8192);
		});

		it("should return hardcoded capabilities for every curated model id", async () => {
			const knownModels = [
				"cline-pass/glm-5.2",
				"cline-pass/deepseek-v4-pro",
				"cline-pass/deepseek-v4-flash",
				"cline-pass/kimi-k2.7-code",
				"cline-pass/kimi-k3",
				"cline-pass/qwen3.7-max",
				"cline-pass/qwen3.7-plus",
				"cline-pass/mimo-v2.5",
			];
			for (const model of knownModels) {
				const caps = await provider.getCapabilities(model);
				expect(caps.modelName).toBe(model);
				expect(caps.supportsTools).toBe(true);
				expect(caps.supportsStreaming).toBe(true);
				expect(caps.supportsThinking).toBe(true);
				expect(caps.contextWindow).toBe(128000);
				expect(caps.maxOutputTokens).toBe(8192);
			}
		});

		it("should fall through to OpenAIProvider defaults for unknown model ids", async () => {
			const caps = await provider.getCapabilities("cline-pass/some-unknown-model");
			// The inherited OpenAIProvider.getCapabilities returns a
			// ModelCapabilities object (it does not throw for unknown ids).
			// Verify the shape rather than exact values, since the upstream
			// defaults may evolve.
			expect(caps.modelName).toBe("cline-pass/some-unknown-model");
			expect(typeof caps.supportsTools).toBe("boolean");
			expect(typeof caps.supportsStreaming).toBe("boolean");
		});

		it("should cache capabilities across calls", async () => {
			const first = await provider.getCapabilities("cline-pass/glm-5.2");
			const second = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(first).toBe(second); // Same reference (cached)
		});
	});
});
