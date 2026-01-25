import { describe, expect, it } from "bun:test";
import type {
	AgentOptions,
	AgentResponse,
	AgentStreamChunk,
	HealthStatus,
	ProviderConfigs,
	RuntimeConfig,
	ShutdownOptions,
	ToolExecution,
} from "@/core/agent.js";
import { Agent } from "@/core/agent.js";
import type { LLMClient } from "@/providers/types.js";
import { ToolRegistry } from "@/tools/registry.js";

describe("Agent interfaces", () => {
	describe("ProviderConfigs", () => {
		it("should allow optional provider configurations", () => {
			const config: ProviderConfigs = {
				openai: { apiKey: "sk-test" },
				anthropic: { apiKey: "sk-ant-test" },
			};

			expect(config.openai?.apiKey).toBe("sk-test");
			expect(config.anthropic?.apiKey).toBe("sk-ant-test");
		});

		it("should allow undefined providers", () => {
			const config: ProviderConfigs = {};

			expect(config.openai).toBeUndefined();
			expect(config.anthropic).toBeUndefined();
		});
	});

	describe("AgentOptions", () => {
		it("should have sensible defaults", () => {
			const options: AgentOptions = {};

			expect(options.maxIterations).toBeUndefined();
			expect(options.systemPrompt).toBeUndefined();
			expect(options.verbose).toBeUndefined();
		});

		it("should allow overriding defaults", () => {
			const options: AgentOptions = {
				maxIterations: 50,
				systemPrompt: "You are a custom agent",
				verbose: true,
				maxContextTokens: 100000,
				memoryFile: "/tmp/memory.json",
				maxMemoryTokens: 5000,
				trackContextUsage: true,
			};

			expect(options.maxIterations).toBe(50);
			expect(options.verbose).toBe(true);
			expect(options.maxContextTokens).toBe(100000);
		});
	});

	describe("RuntimeConfig", () => {
		it("should allow model and thinking override", () => {
			const config: RuntimeConfig = {
				model: "claude-3-5-sonnet",
				thinking: { enabled: true, effort: "high" },
			};

			expect(config.model).toBe("claude-3-5-sonnet");
			expect(config.thinking?.enabled).toBe(true);
		});
	});

	describe("ToolExecution", () => {
		it("should represent running tool", () => {
			const execution: ToolExecution = {
				name: "read",
				status: "running",
				args: { path: "/test" },
			};

			expect(execution.status).toBe("running");
			expect(execution.name).toBe("read");
		});

		it("should represent completed tool", () => {
			const execution: ToolExecution = {
				name: "read",
				status: "complete",
				args: { path: "/test" },
				output: "file content",
				summary: "Read 100 bytes",
			};

			expect(execution.status).toBe("complete");
			expect(execution.output).toBe("file content");
		});

		it("should represent error tool", () => {
			const execution: ToolExecution = {
				name: "read",
				status: "error",
				args: { path: "/test" },
				error: "File not found",
			};

			expect(execution.status).toBe("error");
			expect(execution.error).toBe("File not found");
		});
	});

	describe("AgentStreamChunk", () => {
		it("should represent partial chunk", () => {
			const chunk: AgentStreamChunk = {
				content: "Hello",
				iterations: 1,
				done: false,
				contextStats: {
					systemPromptTokens: 100,
					memoryTokens: 0,
					conversationTokens: 50,
					totalTokens: 150,
					maxContextTokens: 200000,
					truncationApplied: false,
					memoryCount: 0,
				},
			};

			expect(chunk.done).toBe(false);
			expect(chunk.content).toBe("Hello");
		});

		it("should represent final chunk", () => {
			const chunk: AgentStreamChunk = {
				content: "",
				iterations: 2,
				done: true,
				toolExecutions: [{ name: "read", status: "complete", output: "result" }],
			};

			expect(chunk.done).toBe(true);
			expect(chunk.content).toBe("");
			expect(chunk.toolExecutions).toHaveLength(1);
		});

		it("should indicate max iterations reached", () => {
			const chunk: AgentStreamChunk = {
				content: "",
				iterations: 20,
				done: true,
				maxIterationsReached: true,
			};

			expect(chunk.maxIterationsReached).toBe(true);
		});
	});

	describe("AgentResponse", () => {
		it("should contain final response data", () => {
			const response: AgentResponse = {
				content: "Final answer",
				iterations: 3,
				messages: [
					{ role: "user", content: "Hello" },
					{ role: "assistant", content: "Final answer" },
				],
			};

			expect(response.content).toBe("Final answer");
			expect(response.iterations).toBe(3);
			expect(response.messages).toHaveLength(2);
		});
	});

	describe("HealthStatus", () => {
		it("should indicate ready when no issues", () => {
			const status: HealthStatus = {
				ready: true,
				issues: [],
				providerCount: 2,
				skillCount: 5,
				memoryEnabled: true,
				mcpServers: [{ name: "server1", connected: true, toolCount: 10 }],
			};

			expect(status.ready).toBe(true);
			expect(status.issues).toHaveLength(0);
		});

		it("should indicate not ready with issues", () => {
			const status: HealthStatus = {
				ready: false,
				issues: ["MCP server disconnected"],
				providerCount: 1,
				skillCount: 0,
				memoryEnabled: false,
			};

			expect(status.ready).toBe(false);
			expect(status.issues).toHaveLength(1);
		});
	});

	describe("ShutdownOptions", () => {
		it("should allow signal option", () => {
			const options: ShutdownOptions = {
				signal: false,
			};

			expect(options.signal).toBe(false);
		});
	});
});

describe("Agent class structure", () => {
	it("should be instantiable with LLM client and tool registry", () => {
		// Create mock LLM client
		const mockLlmClient: LLMClient = {
			chat: async () => ({
				content: "test",
				toolCalls: undefined,
				finishReason: "stop",
			}),
			stream: async function* () {
				yield { content: "test", done: true };
			},
			getCapabilities: async () => ({
				modelName: "test",
				supportsTools: true,
				supportsStreaming: true,
				supportsToolStreaming: true,
				supportsSystemPrompt: true,
				supportsThinking: false,
				contextWindow: 100000,
				maxOutputTokens: 4096,
			}),
		};

		// Create tool registry (no tools needed for this test)
		const toolRegistry = new ToolRegistry();

		const agent = new Agent(mockLlmClient, toolRegistry);

		expect(agent).toBeDefined();
	});
});
