import { beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync, writeFileSync } from "node:fs";
import { Agent } from "../../src/core/agent.js";
import type { ConversationManager } from "../../src/core/conversation.js";
import type { ChatOptions, ChatResponse, LLMClient, Message, StreamChunk } from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";

const tempConversationFile = "/tmp/test-agent-conversation.json";

beforeEach(() => {
	try {
		unlinkSync(tempConversationFile);
	} catch {
		// Ignore if file doesn't exist
	}
});

class MockLLMClient implements LLMClient {
	async chat(_options: ChatOptions): Promise<ChatResponse> {
		return {
			content: "Mock response",
			finishReason: "stop",
		};
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

function createMessages(...contents: string[]): Message[] {
	return contents.map((content, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content,
	}));
}

describe("Agent", () => {
	describe("startChatSession()", () => {
		it("should reset conversation history to empty array", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			for await (const _chunk of agent.runStream("test", "mock-model")) {
			}

			agent.startChatSession();

			expect(
				(agent as unknown as { _conversationManager: ConversationManager })._conversationManager.getHistory()
			).toEqual([]);
		});
	});

	describe("runStream() - conversation history without file", () => {
		it("should use in-memory history when no conversation file is set", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			const chunks: string[] = [];
			for await (const chunk of agent.runStream("First message", "mock-model")) {
				if (chunk.content) chunks.push(chunk.content);
			}

			const history = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory();
			expect(history.length).toBeGreaterThanOrEqual(2);
			expect(history[0]).toEqual({
				role: "user",
				content: "First message",
			});
		});

		it("should maintain conversation history across multiple turns", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			for await (const _chunk of agent.runStream("Hello", "mock-model")) {
			}

			const historyAfterFirst = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory().length;
			expect(historyAfterFirst).toBeGreaterThan(0);

			for await (const _chunk of agent.runStream("What's my name?", "mock-model")) {
			}

			const history = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory();
			expect(history.length).toBeGreaterThan(historyAfterFirst);
			expect(history[0]).toEqual({
				role: "user",
				content: "Hello",
			});
		});

		it("should start fresh when startChatSession() is called", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			for await (const _chunk of agent.runStream("First session", "mock-model")) {
			}

			expect(
				(agent as unknown as { _conversationManager: ConversationManager })._conversationManager.getHistory().length
			).toBeGreaterThan(0);

			agent.startChatSession();
			expect(
				(agent as unknown as { _conversationManager: ConversationManager })._conversationManager.getHistory()
			).toEqual([]);

			for await (const _chunk of agent.runStream("Second session", "mock-model")) {
			}

			const history = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory();
			expect(history[0]).toEqual({
				role: "user",
				content: "Second session",
			});
		});
	});

	describe("runStream() - with conversation file", () => {
		it("should load conversation from file when conversationFile is set", async () => {
			const existingConversation = createMessages("Previous user message", "Previous assistant response");

			writeFileSync(tempConversationFile, JSON.stringify({ messages: existingConversation }, null, 2));

			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry, {
				conversationFile: tempConversationFile,
			});

			for await (const _chunk of agent.runStream("New message", "mock-model")) {
			}

			const history = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory();
			expect(history[0]).toEqual({
				role: "user",
				content: "Previous user message",
			});
			expect(history[1]).toEqual({
				role: "assistant",
				content: "Previous assistant response",
			});
			expect(history[2]).toEqual({
				role: "user",
				content: "New message",
			});
		});
	});

	describe("_updateConversationHistory()", () => {
		it("should update in-memory history when called", () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			const messages = createMessages("User message", "Assistant response");

			agent._updateConversationHistory(messages);

			expect(
				(agent as unknown as { _conversationManager: ConversationManager })._conversationManager.getHistory()
			).toEqual(messages);
		});
	});

	describe("Tool not found error handling", () => {
		it("should stop loop when tool is not found", async () => {
			// Mock LLM that tries to call a non-existent tool
			class ToolCallMockLLMClient implements LLMClient {
				private callCount = 0;

				async chat(_options: ChatOptions): Promise<ChatResponse> {
					return {
						content: "Mock response",
						finishReason: "stop",
					};
				}

				async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
					this.callCount++;

					if (this.callCount === 1) {
						// First call: try to use a non-existent tool
						yield {
							content: "",
							toolCalls: [
								{
									id: "call_123",
									name: "nonexistent.tool",
									arguments: { param: "value" },
								},
							],
							done: false,
						};
						yield { done: true };
					} else {
						// Second call: provide final answer after error
						yield { content: "I couldn't find that tool. Here's my answer anyway.", done: false };
						yield { done: true };
					}
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

			const llm = new ToolCallMockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			const chunks: unknown[] = [];
			for await (const chunk of agent.runStream("Use a tool", "mock-model")) {
				chunks.push(chunk);
			}

			const lastChunk = chunks[chunks.length - 1] as { iterations: number };
			expect(lastChunk.iterations).toBe(1);

			const history = (
				agent as unknown as { _conversationManager: ConversationManager }
			)._conversationManager.getHistory();
			const hasSystemError = history.some(
				(msg: Message) => msg.role === "system" && msg.content.includes("not available")
			);
			expect(hasSystemError).toBe(true);
		});
	});

	describe("Skill tool restriction", () => {
		it("should filter tools when allowed-tools restriction is set", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			// Add mock tools to registry
			registry.register({
				name: "read",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
				execute: async () => ({ success: true, output: "file content" }),
			});
			registry.register({
				name: "bash",
				description: "Run a bash command",
				parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
				execute: async () => ({ success: true, output: "command output" }),
			});
			registry.register({
				name: "glob",
				description: "Find files",
				parameters: {
					type: "object",
					properties: { pattern: { type: "string" } },
					required: ["pattern"],
				},
				execute: async () => ({ success: true, output: "file1.ts\nfile2.ts" }),
			});

			// Set restriction to only allow 'read' tool
			agent._setSkillRestriction(["read"]);

			// Get tool definitions - should only contain 'read'
			const agentPrivate = agent as unknown as {
				_activeSkillAllowedTools: string[] | undefined;
				_toolRegistry: ToolRegistry;
				_getToolDefinitions(): ReturnType<typeof import("../../src/core/agent.js").Agent.prototype._getToolDefinitions>;
			};
			expect(agentPrivate._activeSkillAllowedTools).toEqual(["read"]);

			const toolDefs = agentPrivate._getToolDefinitions();

			expect(toolDefs.length).toBe(1);
			const firstTool = toolDefs[0];
			expect(firstTool).toBeDefined();
			expect(firstTool?.name).toBe("read");
		});

		it("should return all tools when no restriction is set", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			// Add mock tools to registry
			registry.register({
				name: "read",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
				execute: async () => ({ success: true, output: "file content" }),
			});
			registry.register({
				name: "bash",
				description: "Run a bash command",
				parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
				execute: async () => ({ success: true, output: "command output" }),
			});

			const agentPrivate = agent as unknown as {
				_activeSkillAllowedTools: string[] | undefined;
				_getToolDefinitions(): ReturnType<typeof import("../../src/core/agent.js").Agent.prototype._getToolDefinitions>;
			};
			expect(agentPrivate._activeSkillAllowedTools).toBeUndefined();

			// Get tool definitions - should contain all tools
			const toolDefs = agentPrivate._getToolDefinitions();

			expect(toolDefs.length).toBe(2);
			expect(toolDefs.map((t) => t.name).sort()).toEqual(["bash", "read"]);
		});

		it("should clear restriction when _clearSkillRestriction is called", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			// Add mock tools to registry
			registry.register({
				name: "read",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
				execute: async () => ({ success: true, output: "file content" }),
			});
			registry.register({
				name: "bash",
				description: "Run a bash command",
				parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
				execute: async () => ({ success: true, output: "command output" }),
			});

			// Set restriction then clear it
			agent._setSkillRestriction(["read"]);
			agent._clearSkillRestriction();

			const agentPrivate = agent as unknown as {
				_activeSkillAllowedTools: string[] | undefined;
				_getToolDefinitions(): ReturnType<typeof import("../../src/core/agent.js").Agent.prototype._getToolDefinitions>;
			};
			expect(agentPrivate._activeSkillAllowedTools).toBeUndefined();

			// Get tool definitions - should contain all tools
			const toolDefs = agentPrivate._getToolDefinitions();

			expect(toolDefs.length).toBe(2);
			expect(toolDefs.map((t) => t.name).sort()).toEqual(["bash", "read"]);
		});

		it("should clear restriction at start of runStream", async () => {
			const llm = new MockLLMClient();
			const registry = new ToolRegistry();
			const agent = new Agent(llm, registry);

			// Add mock tools
			registry.register({
				name: "read",
				description: "Read a file",
				parameters: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
				execute: async () => ({ success: true, output: "file content" }),
			});

			const agentPrivate = agent as unknown as {
				_activeSkillAllowedTools: string[] | undefined;
				_getToolDefinitions(): ReturnType<typeof import("../../src/core/agent.js").Agent.prototype._getToolDefinitions>;
			};

			// Set a restriction
			agent._setSkillRestriction(["read"]);
			expect(agentPrivate._activeSkillAllowedTools).toEqual(["read"]);

			// Verify restriction is set
			let toolDefs = agentPrivate._getToolDefinitions();
			expect(toolDefs.length).toBe(1);

			// Start a new runStream - this should clear the restriction
			for await (const _chunk of agent.runStream("test", "mock-model")) {
			}

			// After runStream, restriction should be cleared
			expect(agentPrivate._activeSkillAllowedTools).toBeUndefined();
			toolDefs = agentPrivate._getToolDefinitions();
			expect(toolDefs.length).toBe(1);
		});
	});
});
