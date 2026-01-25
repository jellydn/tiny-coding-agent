import { describe, expect, it } from "bun:test";
import { Agent } from "../../src/core/agent.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk } from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";

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

describe("Agent - Provider Fallback Behavior", () => {
	describe("_getLlmClientForModel() fallback", () => {
		it("should use default client when provider configs are not provided", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const client = (
				agent as unknown as {
					_getLlmClientForModel(model: string): LLMClient;
				}
			)._getLlmClientForModel("gpt-4");

			expect(client).toBe(defaultClient);
		});

		it("should use default client when provider configs are empty object", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				providerConfigs: {},
			});

			const client = (
				agent as unknown as {
					_getLlmClientForModel(model: string): LLMClient;
				}
			)._getLlmClientForModel("gpt-4");

			expect(client).toBe(defaultClient);
		});

		it("should use default client when detectProvider returns unknown type", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const client = (
				agent as unknown as {
					_getLlmClientForModel(model: string): LLMClient;
				}
			)._getLlmClientForModel("unknown-model-123");

			expect(client).toBe(defaultClient);
		});

		it("should not add to provider cache when using default client", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const agentPrivate = agent as unknown as {
				_providerCache: Map<string, { client: LLMClient; timestamp: number }>;
			};

			expect(agentPrivate._providerCache.size).toBe(0);

			(
				agent as unknown as {
					_getLlmClientForModel(model: string): LLMClient;
				}
			)._getLlmClientForModel("gpt-4");

			expect(agentPrivate._providerCache.size).toBe(0);
		});
	});

	describe("runStream() with default client", () => {
		it("should complete successfully with default client", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			let chunksReceived = 0;
			for await (const chunk of agent.runStream("Hello", "mock-model")) {
				chunksReceived++;
				if (chunk.done) break;
			}

			expect(chunksReceived).toBeGreaterThan(0);
		});

		it("should handle streaming response from default client", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Test prompt", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.join("")).toContain("Mock response");
		});

		it("should work with different model names using default client", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const models = ["gpt-4", "claude-3-5-sonnet", "llama3", "custom-model"];

			for (const model of models) {
				const chunks: string[] = [];
				for await (const chunk of agent.runStream("test", model)) {
					if (chunk.content) chunks.push(chunk.content);
				}
				expect(chunks.join("")).toContain("Mock response");
			}
		});
	});

	describe("healthCheck() with provider configuration", () => {
		it("should report ready status when default client is available", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const health = await agent.healthCheck();

			expect(health.ready).toBe(true);
			expect(health.issues).toHaveLength(0);
		});

		it("should report provider count of zero without provider configs", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const health = await agent.healthCheck();

			expect(health.providerCount).toBe(0);
		});

		it("should report skill count in health check", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const health = await agent.healthCheck();

			expect(health.skillCount).toBe(0);
		});

		it("should report memory disabled when no memory file configured", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			const health = await agent.healthCheck();

			expect(health.memoryEnabled).toBe(false);
		});

		it("should report memory enabled when memory file configured", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				memoryFile: "/tmp/test-memory.json",
			});

			const health = await agent.healthCheck();

			expect(health.memoryEnabled).toBe(true);
		});
	});

	describe("agent initialization with various configurations", () => {
		it("should initialize with default options", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			expect(agent).toBeDefined();
		});

		it("should initialize with custom max iterations", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				maxIterations: 50,
			});

			expect(agent).toBeDefined();
		});

		it("should initialize with custom system prompt", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				systemPrompt: "You are a test agent",
			});

			expect(agent).toBeDefined();
		});

		it("should initialize with verbose mode disabled", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				verbose: false,
			});

			expect(agent).toBeDefined();
		});

		it("should initialize with verbose mode enabled", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				verbose: true,
			});

			expect(agent).toBeDefined();
		});

		it("should initialize with context tracking disabled", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				trackContextUsage: false,
			});

			expect(agent).toBeDefined();
		});

		it("should initialize with custom max context tokens", () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry, {
				maxContextTokens: 64000,
			});

			expect(agent).toBeDefined();
		});
	});

	describe("agent shutdown", () => {
		it("should attempt shutdown without throwing uncaught error", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			let threw = false;
			try {
				await agent.shutdown();
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		it("should attempt shutdown with signal option false", async () => {
			const defaultClient = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(defaultClient, registry);

			let threw = false;
			try {
				await agent.shutdown({ signal: false });
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});
	});
});
