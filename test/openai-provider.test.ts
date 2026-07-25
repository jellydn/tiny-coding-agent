import { describe, expect, it } from "bun:test";
import { OpenAIProvider } from "@/providers/openai.js";

describe("OpenAIProvider", () => {
	describe("constructor", () => {
		it("should initialize with config", () => {
			const provider = new OpenAIProvider({ apiKey: "test-key" });

			expect(provider).toBeDefined();
		});

		it("should initialize with config and baseUrl", () => {
			const provider = new OpenAIProvider({
				apiKey: "test-key",
				baseUrl: "https://custom.api.com",
			});

			expect(provider).toBeDefined();
		});
	});
});

describe("OpenAIProvider capabilities", () => {
	it("should return capabilities for known GPT-4o model", async () => {
		const provider = new OpenAIProvider({ apiKey: "test-key" });

		const capabilities = await provider.getCapabilities("gpt-4o");

		expect(capabilities.modelName).toBe("gpt-4o");
		expect(capabilities.supportsTools).toBe(true);
		expect(capabilities.supportsStreaming).toBe(true);
		expect(capabilities.supportsSystemPrompt).toBe(true);
		expect(capabilities.contextWindow).toBe(128000);
		expect(capabilities.maxOutputTokens).toBe(4096);
	});

	it("should return capabilities for o1 model with thinking enabled", async () => {
		const provider = new OpenAIProvider({ apiKey: "test-key" });

		const capabilities = await provider.getCapabilities("o1");

		expect(capabilities.modelName).toBe("o1");
		expect(capabilities.supportsThinking).toBe(true);
		expect(capabilities.supportsTools).toBe(true); // o1 supports function calling
		expect(capabilities.supportsSystemPrompt).toBe(true); // o1 supports developer/system messages
		expect(capabilities.contextWindow).toBe(200000);
		expect(capabilities.maxOutputTokens).toBe(100000);
	});

	it("should cache capabilities", async () => {
		const provider = new OpenAIProvider({ apiKey: "test-key" });

		const caps1 = await provider.getCapabilities("gpt-4o");
		const caps2 = await provider.getCapabilities("gpt-4o");

		expect(caps1).toBe(caps2);
	});

	it("should use fallback context window for unknown models", async () => {
		const provider = new OpenAIProvider({ apiKey: "test-key" });

		const capabilities = await provider.getCapabilities("unknown-model");

		expect(capabilities.modelName).toBe("unknown-model");
		expect(capabilities.contextWindow).toBe(16385); // fallback
	});

	it("should have correct capabilities for different model types", async () => {
		const provider = new OpenAIProvider({ apiKey: "test-key" });

		// Standard chat model
		const chatCaps = await provider.getCapabilities("gpt-3.5-turbo");
		expect(chatCaps.supportsTools).toBe(true);
		expect(chatCaps.supportsThinking).toBe(false);

		// Reasoning model (supports tools and system prompts)
		const reasonCaps = await provider.getCapabilities("o1-mini");
		expect(reasonCaps.supportsThinking).toBe(true);
		expect(reasonCaps.supportsTools).toBe(true);
		expect(reasonCaps.supportsSystemPrompt).toBe(true);
	});
});
