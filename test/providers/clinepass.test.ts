import { describe, expect, it } from "bun:test";
import { ClinePassProvider } from "../../src/providers/clinepass.js";
import { OpenAIProvider } from "../../src/providers/openai.js";

const DEFAULT_BASE_URL = "https://api.cline.bot/v1";
const CUSTOM_BASE_URL = "https://custom.example.com/v1";

describe("ClinePassProvider", () => {
	describe("constructor", () => {
		it("should default baseUrl to https://api.cline.bot/v1 and forward it to the parent", () => {
			const provider = new ClinePassProvider({ apiKey: "test-key" });
			expect(provider).toBeInstanceOf(ClinePassProvider);
			// Inherits from OpenAIProvider so it satisfies the LLMClient contract.
			expect(provider).toBeInstanceOf(OpenAIProvider);
			// Asserts the resolved baseUrl actually flows into the provider, not just
			// that construction accepts the config surface.
			expect(provider.getResolvedBaseUrl()).toBe(DEFAULT_BASE_URL);
		});

		it("should accept and forward a custom baseUrl", () => {
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: CUSTOM_BASE_URL,
			});
			expect(provider).toBeInstanceOf(ClinePassProvider);
			expect(provider.getResolvedBaseUrl()).toBe(CUSTOM_BASE_URL);
		});

		it("should retain the custom baseUrl even when it equals the upstream default", () => {
			// Defends against an accidental `||` short-circuit that drops an
			// explicit-but-equal baseUrl.
			const provider = new ClinePassProvider({
				apiKey: "test-key",
				baseUrl: DEFAULT_BASE_URL,
			});
			expect(provider.getResolvedBaseUrl()).toBe(DEFAULT_BASE_URL);
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

		it("should fall through to OpenAIProvider defaults (not the ClinePass hardcoded entry) for unknown model ids", async () => {
			// Marker id chosen deliberately so the test deterministically
			// exercises OpenAIProvider's hardcoded fallback path:
			//   1. CLINEPASS_MODEL_IDS contains no entry matching this id
			//      (no underscores, no `__definitely-not-in-catalog__` pattern).
			//   2. models.dev has no entry for it under the "openai" provider
			//      either, so the parent's catalog lookup returns null and
			//      control reaches the bottom hardcoded-fallback block.
			const unknownId = "cline-pass/__definitely-not-in-catalog__";
			const caps = await provider.getCapabilities(unknownId);
			expect(caps.modelName).toBe(unknownId);
			// The ClinePass hardcoded entry reports supportsThinking=true,
			// contextWindow=128000, maxOutputTokens=8192. The OpenAI-parent
			// fallback returns the contrasting values below, so a regression
			// that always returned the ClinePass default would fail at least
			// one of these assertions.
			expect(caps.supportsThinking).toBe(false);
			expect(caps.contextWindow).toBe(16385);
			expect(caps.maxOutputTokens).toBe(4096);
			expect(caps.source).toBe("fallback");
		});

		it("should cache capabilities across calls", async () => {
			const first = await provider.getCapabilities("cline-pass/glm-5.2");
			const second = await provider.getCapabilities("cline-pass/glm-5.2");
			expect(first).toBe(second); // Same reference (cached)
		});
	});
});
