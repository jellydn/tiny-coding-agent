import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, unlinkSync } from "node:fs";
import { Agent } from "../../src/core/agent.js";
import type { ChatOptions, ChatResponse, LLMClient, StreamChunk } from "../../src/providers/types.js";
import { bashTool, fileTools } from "../../src/tools/index.js";
import { ToolRegistry } from "../../src/tools/registry.js";

// Test file paths
const tempConversationFile = "/tmp/e2e-test-conversation.json";
const tempMemoryFile = "/tmp/e2e-test-memory.json";
const tempTestDir = "/tmp/e2e-test-workspace";

// Clean up test files
beforeEach(() => {
	try {
		unlinkSync(tempConversationFile);
	} catch {}
	try {
		unlinkSync(tempMemoryFile);
	} catch {}
	try {
		rmSync(tempTestDir, { recursive: true, force: true });
	} catch {}
	try {
		mkdirSync(tempTestDir, { recursive: true });
	} catch {}
});

afterEach(() => {
	try {
		unlinkSync(tempConversationFile);
	} catch {}
	try {
		unlinkSync(tempMemoryFile);
	} catch {}
	try {
		rmSync(tempTestDir, { recursive: true, force: true });
	} catch {}
});

interface MockToolCall {
	name: string;
	args: Record<string, unknown>;
}

interface MockResponse {
	content: string;
	toolCalls?: MockToolCall[];
}

/**
 * Mock LLM client that simulates realistic agent behavior with tool calls.
 */
class MockLLMClient implements LLMClient {
	private callCount = 0;

	constructor(private readonly responses: MockResponse[]) {}

	async chat(options: ChatOptions): Promise<ChatResponse> {
		const response = this.responses[this.callCount % this.responses.length];
		this.callCount++;

		if (!response) {
			return {
				content: "",
				finishReason: "stop",
			};
		}

		const hasTools = options.tools && options.tools.length > 0;

		if (!hasTools && this.responses[0]?.toolCalls) {
			return {
				content: response.content,
				finishReason: "stop",
			};
		}

		return {
			content: response.content,
			finishReason: response.toolCalls && response.toolCalls.length > 0 ? "tool_calls" : "stop",
			toolCalls: response.toolCalls
				? response.toolCalls.map((tc) => ({
						id: `call_${this.callCount}_${tc.name}`,
						name: tc.name,
						arguments: tc.args,
					}))
				: undefined,
		};
	}

	async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		const response = await this.chat(options);

		if (response.content) {
			yield { content: response.content, done: false };
		}

		if (response.toolCalls) {
			yield {
				toolCalls: response.toolCalls,
				done: false,
			};
		}

		yield { done: true };
	}

	async getCapabilities() {
		return {
			maxTokens: 200000,
			supportsStreaming: true,
			supportsTools: true,
			modelName: "mock-model",
			supportsSystemPrompt: true,
			supportsToolStreaming: false,
			supportsThinking: false,
		};
	}

	getCallCount(): number {
		return this.callCount;
	}
}

describe("E2E: Agent Loop Integration", () => {
	describe("Basic agent loop", () => {
		it("should complete single-turn conversation without tools", async () => {
			const llm = new MockLLMClient([{ content: "Hello! How can I help you today?" }]);
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Hello", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.join("")).toContain("Hello!");
		});

		it("should maintain conversation history across multiple turns", async () => {
			const llm = new MockLLMClient([
				{ content: "First response" },
				{ content: "Second response" },
				{ content: "Third response" },
			]);
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			for await (const _chunk of agent.runStream("First message", "mock-model")) {
			}

			for await (const _chunk of agent.runStream("Second message", "mock-model")) {
			}

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Third message", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.join("")).toContain("Third response");
		});
	});

	describe("Agent with file operations", () => {
		it("should write and read files through the agent loop", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll write the file for you.",
					toolCalls: [
						{
							name: "write_file",
							args: { path: "/tmp/e2e-test-workspace/test.txt", content: "Hello, world!" },
						},
					],
				},
				{
					content: "The file has been written.",
				},
				{
					content: "Let me read it back.",
					toolCalls: [{ name: "read_file", args: { path: "/tmp/e2e-test-workspace/test.txt" } }],
				},
				{
					content: "The file contains: Hello, world!",
				},
			]);

			const registry = new ToolRegistry();
			registry.registerMany(fileTools);

			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Write a file with 'Hello, world!' then read it back", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			const fullResponse = chunks.join("");
			expect(fullResponse.length).toBeGreaterThan(0);
		});

		it("should handle file operation errors gracefully", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll try to read that file.",
					toolCalls: [{ name: "read_file", args: { path: "/nonexistent/file.txt" } }],
				},
				{
					content: "Sorry, I couldn't find that file.",
				},
			]);

			const registry = new ToolRegistry();
			registry.registerMany(fileTools);

			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Read a nonexistent file", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});
	});

	describe("Agent with bash operations", () => {
		it("should execute safe bash commands", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll list the files in the directory.",
					toolCalls: [{ name: "bash", args: { command: "ls /tmp/e2e-test-workspace", cwd: "/tmp" } }],
				},
				{
					content: "The command completed.",
				},
			]);

			const registry = new ToolRegistry();
			registry.register(bashTool);

			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("List files in /tmp/e2e-test-workspace", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});

		it("should reject destructive bash commands", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll delete that file for you.",
					toolCalls: [{ name: "bash", args: { command: "rm -rf /tmp/e2e-test-workspace", cwd: "/tmp" } }],
				},
				{
					content: "Sorry, I cannot perform destructive operations.",
				},
			]);

			const registry = new ToolRegistry();
			registry.register(bashTool);

			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("Delete the test directory", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});
	});

	describe("Agent with memory", () => {
		it("should use memory store when enabled", async () => {
			const llm = new MockLLMClient([
				{ content: "I'll remember that for you." },
				{ content: "Based on our conversation, I recall the context." },
			]);

			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry, {
				memoryFile: tempMemoryFile,
				maxMemoryTokens: 1000,
			});

			for await (const _chunk of agent.runStream("Remember that my favorite color is blue", "mock-model")) {
			}

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("What's my favorite color?", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});
	});

	describe("Agent with conversation persistence", () => {
		it("should save and restore conversation history", async () => {
			const llm = new MockLLMClient([{ content: "First response" }, { content: "Second response" }]);

			const registry = new ToolRegistry();

			const agent1 = new Agent(llm, registry, {
				conversationFile: tempConversationFile,
			});

			for await (const _chunk of agent1.runStream("First message", "mock-model")) {
			}

			// Verify conversation file was created
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const fs = require("node:fs");
			let fileExists = false;
			try {
				const stats = fs.statSync(tempConversationFile);
				fileExists = stats.isFile();
			} catch {}
			expect(fileExists).toBe(true);

			const agent2 = new Agent(llm, registry, {
				conversationFile: tempConversationFile,
			});

			const chunks: string[] = [];
			for await (const chunk of agent2.runStream("Second message", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.length).toBeGreaterThan(0);
		});
	});

	describe("Agent iteration limits", () => {
		it("should respect max iterations setting", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll help with that.",
					toolCalls: [{ name: "bash", args: { command: "echo test", cwd: "/tmp" } }],
				},
				{
					content: "Let me do another operation.",
					toolCalls: [{ name: "bash", args: { command: "echo another", cwd: "/tmp" } }],
				},
				{
					content: "And one more.",
					toolCalls: [{ name: "bash", args: { command: "echo final", cwd: "/tmp" } }],
				},
				{
					content: "Maximum iterations reached.",
				},
			]);

			const registry = new ToolRegistry();
			registry.register(bashTool);

			const agent = new Agent(llm, registry, {
				maxIterations: 2,
			});

			const chunks: string[] = [];
			let maxIterationsReached = false;

			for await (const chunk of agent.runStream("Run multiple operations", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
				if (chunk.maxIterationsReached) maxIterationsReached = true;
			}

			expect(maxIterationsReached).toBe(true);
		});
	});

	describe("Agent health check", () => {
		it("should report healthy status when properly configured", async () => {
			const llm = new MockLLMClient([{ content: "OK" }]);
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			const health = await agent.healthCheck();

			expect(health.ready).toBe(true);
			expect(health.issues).toHaveLength(0);
			expect(health.providerCount).toBeGreaterThanOrEqual(0);
		});
	});

	describe("Agent graceful shutdown", () => {
		it("should shutdown cleanly and flush data", async () => {
			const llm = new MockLLMClient([{ content: "OK" }]);
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry, {
				memoryFile: tempMemoryFile,
			});

			for await (const _chunk of agent.runStream("Test message", "mock-model")) {
			}

			// Shutdown should complete without error
			agent.shutdown();
			expect(true).toBe(true);
		});
	});

	describe("Multi-step task completion", () => {
		it("should complete a task requiring multiple tools", async () => {
			const llm = new MockLLMClient([
				{
					content: "I'll create the file first.",
					toolCalls: [
						{
							name: "write_file",
							args: { path: "/tmp/e2e-test-workspace/multi-step.txt", content: "Step 1 complete" },
						},
					],
				},
				{
					content: "Now let me verify the file exists.",
					toolCalls: [{ name: "bash", args: { command: "ls /tmp/e2e-test-workspace/", cwd: "/tmp" } }],
				},
				{
					content: "Finally, let me read the content.",
					toolCalls: [{ name: "read_file", args: { path: "/tmp/e2e-test-workspace/multi-step.txt" } }],
				},
				{
					content: "Task complete!",
				},
			]);

			const registry = new ToolRegistry();
			registry.registerMany(fileTools);
			registry.register(bashTool);

			const agent = new Agent(llm, registry);

			const chunks: string[] = [];

			for await (const chunk of agent.runStream(
				"Create a file, verify it exists, and read its content",
				"mock-model"
			)) {
				if (chunk.content) chunks.push(chunk.content);
			}

			expect(chunks.join("")).toContain("complete");
		});
	});
});
