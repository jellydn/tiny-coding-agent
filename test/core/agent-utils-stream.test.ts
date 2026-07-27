import { describe, expect, it } from "bun:test";
import { streamLlmResponse } from "../../src/core/agent-utils.js";
import type { ModelCapabilities } from "../../src/providers/capabilities.js";
import type {
	ChatOptions,
	LLMClient,
	Message,
	StreamChunk,
	ToolCall,
	ToolDefinition,
} from "../../src/providers/types.js";

/** Build a mock LLMClient whose stream() yields the given chunks. */
function mockClient(chunks: StreamChunk[]): LLMClient {
	return {
		async chat(_options: ChatOptions) {
			return { content: "mock", finishReason: "stop" };
		},
		async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
			for (const chunk of chunks) yield chunk;
		},
		async getCapabilities(_model: string): Promise<ModelCapabilities> {
			return {
				modelName: "mock",
				supportsTools: true,
				supportsStreaming: true,
				supportsSystemPrompt: true,
				supportsToolStreaming: true,
				supportsThinking: false,
				contextWindow: 128000,
				maxOutputTokens: 4096,
				isVerified: false,
				source: "fallback",
			};
		},
	};
}

describe("streamLlmResponse", () => {
	const baseMessages: Message[] = [{ role: "user", content: "hello" }];

	it("should yield content strings from the stream", async () => {
		const client = mockClient([{ content: "Hello ", done: false }, { content: "world!", done: false }, { done: true }]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		const contents: string[] = [];
		while (true) {
			const { value, done } = await gen.next();
			if (done) break;
			contents.push(value);
		}

		expect(contents).toEqual(["Hello ", "world!"]);
	});

	it("should collect tool calls from the stream", async () => {
		const toolCalls: ToolCall[] = [{ id: "tc-1", name: "read_file", arguments: { path: "/test" } }];
		const client = mockClient([{ toolCalls, done: false }, { content: "done", done: false }, { done: true }]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { toolCalls: ToolCall[] } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { toolCalls: ToolCall[] };
				break;
			}
		}

		expect(result?.toolCalls).toEqual(toolCalls);
	});

	it("should collect usage from the final chunk", async () => {
		const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
		const client = mockClient([
			{ content: "response", done: false },
			{ usage, done: true },
		]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { usage?: typeof usage } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { usage?: typeof usage };
				break;
			}
		}

		expect(result?.usage).toEqual(usage);
	});

	it("should track timeToFirstTokenMs on first content chunk", async () => {
		const client = mockClient([{ content: "first", done: false }, { content: "second", done: false }, { done: true }]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { timeToFirstTokenMs?: number } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { timeToFirstTokenMs?: number };
				break;
			}
		}

		expect(result?.timeToFirstTokenMs).toBeDefined();
		expect(typeof result?.timeToFirstTokenMs).toBe("number");
	});

	it("should track timeToFirstTokenMs on first toolCalls chunk (no content)", async () => {
		const client = mockClient([
			{ toolCalls: [{ id: "tc-1", name: "glob", arguments: {} }], done: false },
			{ done: true },
		]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { timeToFirstTokenMs?: number } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { timeToFirstTokenMs?: number };
				break;
			}
		}

		expect(result?.timeToFirstTokenMs).toBeDefined();
	});

	it("should leave timeToFirstTokenMs undefined when stream is empty", async () => {
		const client = mockClient([{ done: true }]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { timeToFirstTokenMs?: number; toolCalls: ToolCall[] } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { timeToFirstTokenMs?: number; toolCalls: ToolCall[] };
				break;
			}
		}

		expect(result?.timeToFirstTokenMs).toBeUndefined();
		expect(result?.toolCalls).toEqual([]);
	});

	it("should prepend system prompt to messages", async () => {
		let capturedMessages: Message[] | undefined;
		const client: LLMClient = {
			async chat() {
				return { content: "mock", finishReason: "stop" };
			},
			async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
				capturedMessages = options.messages;
				yield { done: true };
			},
			async getCapabilities() {
				return {
					modelName: "mock",
					supportsTools: true,
					supportsStreaming: true,
					supportsSystemPrompt: true,
					supportsToolStreaming: true,
					supportsThinking: false,
					contextWindow: 128000,
					maxOutputTokens: 4096,
					isVerified: false,
					source: "fallback",
				};
			},
		};

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "SYSTEM_PROMPT_HERE",
			messages: baseMessages,
		});
		await gen.next(); // trigger the stream

		expect(capturedMessages).toBeDefined();
		expect(capturedMessages?.[0]).toEqual({ role: "system", content: "SYSTEM_PROMPT_HERE" });
		expect(capturedMessages?.[1]).toEqual({ role: "user", content: "hello" });
	});

	it("should pass tools to the stream when provided", async () => {
		let capturedTools: ToolDefinition[] | undefined;
		const client: LLMClient = {
			async chat() {
				return { content: "mock", finishReason: "stop" };
			},
			async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
				capturedTools = options.tools;
				yield { done: true };
			},
			async getCapabilities() {
				return {
					modelName: "mock",
					supportsTools: true,
					supportsStreaming: true,
					supportsSystemPrompt: true,
					supportsToolStreaming: true,
					supportsThinking: false,
					contextWindow: 128000,
					maxOutputTokens: 4096,
					isVerified: false,
					source: "fallback",
				};
			},
		};

		const tools: ToolDefinition[] = [
			{ name: "read_file", description: "Read a file", parameters: { type: "object", properties: {} } },
		];
		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
			tools,
		});
		await gen.next();

		expect(capturedTools).toEqual(tools);
	});

	it("should pass undefined tools when not provided (loop-detection mode)", async () => {
		let capturedTools: ToolDefinition[] | undefined;
		const client: LLMClient = {
			async chat() {
				return { content: "mock", finishReason: "stop" };
			},
			async *stream(options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
				capturedTools = options.tools;
				yield { done: true };
			},
			async getCapabilities() {
				return {
					modelName: "mock",
					supportsTools: true,
					supportsStreaming: true,
					supportsSystemPrompt: true,
					supportsToolStreaming: true,
					supportsThinking: false,
					contextWindow: 128000,
					maxOutputTokens: 4096,
					isVerified: false,
					source: "fallback",
				};
			},
		};

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
			// no tools — simulates loop-detection final answer
		});
		await gen.next();

		expect(capturedTools).toBeUndefined();
	});

	it("should accumulate multiple tool call chunks", async () => {
		const client = mockClient([
			{ toolCalls: [{ id: "tc-1", name: "glob", arguments: { pattern: "*.ts" } }], done: false },
			{ toolCalls: [{ id: "tc-2", name: "read_file", arguments: { path: "foo.ts" } }], done: false },
			{ done: true },
		]);

		const gen = streamLlmResponse({
			llmClient: client,
			model: "test-model",
			systemPrompt: "You are helpful",
			messages: baseMessages,
		});

		let result: { toolCalls: ToolCall[] } | undefined;
		while (true) {
			const { value, done } = await gen.next();
			if (done) {
				result = value as { toolCalls: ToolCall[] };
				break;
			}
		}

		expect(result?.toolCalls).toHaveLength(2);
		expect(result?.toolCalls[0]?.name).toBe("glob");
		expect(result?.toolCalls[1]?.name).toBe("read_file");
	});
});
