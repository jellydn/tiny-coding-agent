import { describe, expect, it, spyOn } from "bun:test";
import { ProviderCache } from "../../src/core/provider-cache.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk } from "../../src/providers/types.js";

class MockLLMClient implements LLMClient {
	async chat(_options: ChatOptions): Promise<ChatResponse> {
		return { content: "Mock response", finishReason: "stop" };
	}

	async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		yield { content: "Mock response", done: false };
		yield { done: true };
	}

	async getCapabilities(_model: string) {
		return {
			maxTokens: 100000,
			supportsStreaming: true,
			supportsTools: true,
			modelName: "mock-model",
			supportsSystemPrompt: true,
			supportsToolStreaming: false,
			supportsThinking: false,
		};
	}
}

describe("ProviderCache", () => {
	const defaultClient = new MockLLMClient();

	describe("getClientForModel", () => {
		it("should return default client when no provider configs are set", () => {
			const cache = new ProviderCache(defaultClient);

			const client = cache.getClientForModel("gpt-4o");

			expect(client).toBe(defaultClient);
		});

		it("should return default client when provider configs are empty", () => {
			const cache = new ProviderCache(defaultClient, {});

			const client = cache.getClientForModel("gpt-4o");

			// detectProvider("gpt-4o") = "openai", but no openai config →
			// createProvider throws → fallback to default
			expect(client).toBe(defaultClient);
		});

		it("should return default client for unknown model string", () => {
			const cache = new ProviderCache(defaultClient);

			const client = cache.getClientForModel("unknown-model-xyz");

			expect(client).toBe(defaultClient);
		});

		it("should not add to cache when using default client (no configs)", () => {
			const cache = new ProviderCache(defaultClient);

			expect(cache.size).toBe(0);

			cache.getClientForModel("gpt-4o");

			expect(cache.size).toBe(0);
		});
	});

	describe("getProviderName", () => {
		it("should detect openai provider for gpt-4o", () => {
			const cache = new ProviderCache(defaultClient);

			expect(cache.getProviderName("gpt-4o")).toBe("openai");
		});

		it("should detect anthropic provider for claude-sonnet-4", () => {
			const cache = new ProviderCache(defaultClient);

			expect(cache.getProviderName("claude-sonnet-4")).toBe("anthropic");
		});

		it("should detect ollama provider for qwen3-coder", () => {
			const cache = new ProviderCache(defaultClient);

			expect(cache.getProviderName("qwen3-coder")).toBe("ollama");
		});

		it("should return a non-empty string for empty model", () => {
			const cache = new ProviderCache(defaultClient);

			// detectProvider("") returns "ollama" as default, not "unknown"
			const result = cache.getProviderName("");
			expect(result).toBeTruthy();
		});

		it("should not throw for invalid model strings", () => {
			const cache = new ProviderCache(defaultClient);

			expect(() => cache.getProviderName("")).not.toThrow();
			expect(() => cache.getProviderName("!!!invalid!!!")).not.toThrow();
		});
	});

	describe("size getter", () => {
		it("should start at zero", () => {
			const cache = new ProviderCache(defaultClient);

			expect(cache.size).toBe(0);
		});

		it("should remain zero when no configs are set", () => {
			const cache = new ProviderCache(defaultClient);

			cache.getClientForModel("gpt-4o");
			cache.getClientForModel("claude-sonnet-4");

			expect(cache.size).toBe(0);
		});
	});

	describe("fallback behavior", () => {
		it("should log a warning when provider creation fails", () => {
			const warnSpy = spyOn(console, "warn").mockReturnValue(undefined);
			const cache = new ProviderCache(defaultClient, {});

			// detectProvider("gpt-4o") = "openai", createProvider will throw
			// because the configs object is empty (no openai config)
			cache.getClientForModel("gpt-4o");

			expect(warnSpy).toHaveBeenCalled();
			const output = warnSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
			expect(output).toContain("ProviderCache");
			expect(output).toContain("falling back to default");

			warnSpy.mockRestore();
		});

		it("should return the same default client instance on fallback", () => {
			const cache = new ProviderCache(defaultClient, {});

			const client1 = cache.getClientForModel("gpt-4o");
			const client2 = cache.getClientForModel("claude-sonnet-4");

			expect(client1).toBe(defaultClient);
			expect(client2).toBe(defaultClient);
		});
	});
});
