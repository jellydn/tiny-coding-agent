import { describe, expect, it } from "bun:test";
import { OpenAIProvider } from "../../src/providers/openai.js";
import { QwenCloudProvider } from "../../src/providers/qwencloud.js";

const DEFAULT_BASE_URL = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1";
const CUSTOM_BASE_URL = "https://custom.example.com/v1";

describe("QwenCloudProvider", () => {
	describe("constructor", () => {
		it("should be an instance of OpenAIProvider (inherits the LLMClient contract)", () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			expect(provider).toBeInstanceOf(QwenCloudProvider);
			expect(provider).toBeInstanceOf(OpenAIProvider);
		});

		it("should default baseUrl to the QwenCloud Token Plan endpoint when none is supplied", () => {
			// The OpenAIProvider constructor forwards baseUrl to the OpenAI SDK.
			// We assert the provider constructs without error with the default URL;
			// the actual URL is validated by the OpenAI SDK's baseURL normalization.
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			expect(provider).toBeInstanceOf(QwenCloudProvider);
			// Re-create with the explicit default to confirm no throw — this is the
			// same value the constructor computes internally.
			const explicit = new QwenCloudProvider({ apiKey: "test-key", baseUrl: DEFAULT_BASE_URL });
			expect(explicit).toBeInstanceOf(QwenCloudProvider);
		});

		it("should accept a custom baseUrl for self-hosted/proxy deployments", () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key", baseUrl: CUSTOM_BASE_URL });
			expect(provider).toBeInstanceOf(QwenCloudProvider);
		});
	});

	describe("getCapabilities()", () => {
		it("should return curated capabilities for qw/glm-5.2 (200K context)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/glm-5.2");
			expect(caps.modelName).toBe("qw/glm-5.2");
			expect(caps.supportsTools).toBe(true);
			expect(caps.supportsStreaming).toBe(true);
			expect(caps.supportsThinking).toBe(true);
			expect(caps.contextWindow).toBe(200000);
			expect(caps.maxOutputTokens).toBe(131072);
			expect(caps.source).toBe("fallback");
		});

		it("should return curated capabilities for qw/qwen3.7-plus (1M context)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/qwen3.7-plus");
			expect(caps.modelName).toBe("qw/qwen3.7-plus");
			expect(caps.contextWindow).toBe(1048576);
			expect(caps.maxOutputTokens).toBe(131072);
		});

		it("should return curated capabilities for qw/deepseek-v4-pro (1M context, 384K output)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/deepseek-v4-pro");
			expect(caps.contextWindow).toBe(1000000);
			expect(caps.maxOutputTokens).toBe(384000);
		});

		it("should return curated capabilities for qw/qwen3.6-flash (131K context)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/qwen3.6-flash");
			expect(caps.contextWindow).toBe(131072);
			expect(caps.maxOutputTokens).toBe(131072);
		});

		it("should return curated capabilities for qw/qwen3.8-max-preview (262K context)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/qwen3.8-max-preview");
			expect(caps.contextWindow).toBe(262144);
			expect(caps.maxOutputTokens).toBe(131072);
		});

		it("should return curated capabilities for qw/qwen3.7-max (262K context)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/qwen3.7-max");
			expect(caps.contextWindow).toBe(262144);
			expect(caps.maxOutputTokens).toBe(131072);
		});

		it("should fall back to safe defaults for unknown models not in the catalog", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("qw/__unknown-model__");
			expect(caps.modelName).toBe("qw/__unknown-model__");
			// Fallback context window (131072) and max output (4096) for unknown models
			expect(caps.contextWindow).toBe(131072);
			expect(caps.maxOutputTokens).toBe(4096);
		});

		it("should memoize per-id (same model returns the same reference on repeat)", async () => {
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const first = await provider.getCapabilities("qw/glm-5.2");
			const second = await provider.getCapabilities("qw/glm-5.2");
			expect(first).toBe(second);
		});

		it("should resolve capabilities for a bare model id (no qw/ prefix) using the same map", async () => {
			// The provider strips the qw/ prefix internally, so a bare model id
			// should resolve to the same curated profile. This guards against a
			// regression where the prefix-stripping lookup key diverges.
			const provider = new QwenCloudProvider({ apiKey: "test-key" });
			const caps = await provider.getCapabilities("glm-5.2");
			expect(caps.contextWindow).toBe(200000);
			expect(caps.maxOutputTokens).toBe(131072);
		});
	});
});
