import { describe, expect, it, vi } from "bun:test";
import { AgentObservability } from "../../src/core/agent-observability.js";
import { DebugLogger } from "../../src/core/debug-logger.js";
import { RunnerObservability } from "../../src/core/runner-observability.js";
import {
	type StreamChunk as ProcessorStreamChunk,
	StreamProcessor,
	type StreamProcessorConfig,
	type StreamProcessorResult,
} from "../../src/core/stream-processor.js";
import { TurnExecutor } from "../../src/core/turn-executor.js";
import type { ModelCapabilities } from "../../src/providers/capabilities.js";
import type { LLMClient, Message, StreamChunk as ProviderStreamChunk } from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";

/**
 * Build a mock LLMClient whose stream() yields the given chunk arrays,
 * one array per stream call (index advances on each call). This lets a
 * single test script a tool-call iteration followed by a final answer.
 */
function makeMockClient(chunksPerCall: ProviderStreamChunk[][]): LLMClient {
	let callIndex = 0;
	return {
		async chat() {
			return { content: "mock", finishReason: "stop" };
		},
		async *stream(): AsyncGenerator<ProviderStreamChunk, void, unknown> {
			const chunks = chunksPerCall[Math.min(callIndex, chunksPerCall.length - 1)] ?? [];
			callIndex += 1;
			for (const chunk of chunks) {
				yield chunk;
			}
		},
		async getCapabilities(): Promise<ModelCapabilities> {
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

interface Harness {
	config: StreamProcessorConfig;
	messages: Message[];
	onSaveHistory: ReturnType<typeof vi.fn>;
}

/** Build a full StreamProcessorConfig with real dependencies (TurnExecutor,
 *  RunnerObservability, DebugLogger) plus a registered test tool. */
function makeHarness(llmClient: LLMClient, overrides: Partial<Omit<StreamProcessorConfig, "llmClient">> = {}): Harness {
	const messages: Message[] = [{ role: "user", content: "hello" }];
	const onSaveHistory = vi.fn(async () => {});

	const registry = new ToolRegistry();
	registry.register({
		name: "test_tool",
		description: "A test tool",
		parameters: { type: "object", properties: {} },
		execute: async () => ({ success: true, output: "tool output" }),
	});
	const turnExecutor = new TurnExecutor(registry, { verbose: false });
	const runnerObs = new RunnerObservability(new AgentObservability({}), "test-provider", "test-model");

	const config: StreamProcessorConfig = {
		llmClient,
		model: "test-model",
		systemPrompt: "You are helpful",
		messages,
		maxIterations: 3,
		trackContextUsage: true,
		turnExecutor,
		runnerObs,
		debug: new DebugLogger(false),
		updateStats: () => ({
			systemPromptTokens: 10,
			memoryTokens: 0,
			conversationTokens: 20,
			totalTokens: 30,
			maxContextTokens: 32000,
			truncationApplied: false,
			memoryCount: 0,
		}),
		onSaveHistory,
		userPrompt: "hello",
		...overrides,
	};

	return { config, messages, onSaveHistory };
}

/** Iterate process() manually (for-await would discard the generator's
 *  return value) and collect both the yielded chunks and the result. */
async function collect(
	processor: StreamProcessor
): Promise<{ chunks: ProcessorStreamChunk[]; result: StreamProcessorResult }> {
	const chunks: ProcessorStreamChunk[] = [];
	const gen = processor.process();
	let result: StreamProcessorResult = { content: "", iterations: 0 };
	while (true) {
		const { value, done } = await gen.next();
		if (done) {
			result = value;
			break;
		}
		chunks.push(value);
	}
	return { chunks, result };
}

describe("StreamProcessor", () => {
	it("should stream content chunks and return the final content", async () => {
		const client = makeMockClient([
			[{ content: "Hello ", done: false }, { content: "world!", done: false }, { done: true }],
		]);
		const { config, onSaveHistory } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		expect(chunks.filter((c) => c.content !== "").map((c) => c.content)).toEqual(["Hello ", "world!"]);
		expect(result.content).toBe("Hello world!");
		expect(result.iterations).toBe(1);
		expect(onSaveHistory).toHaveBeenCalledTimes(1);
	});

	it("should increment iterations across the tool-execution loop", async () => {
		const client = makeMockClient([
			[{ toolCalls: [{ id: "call-1", name: "test_tool", arguments: {} }], done: false }, { done: true }],
			[{ content: "answer", done: false }, { done: true }],
		]);
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		expect(result.iterations).toBe(2);
		expect(chunks.some((c) => c.iterations === 1)).toBe(true);
		expect(chunks.some((c) => c.iterations === 2)).toBe(true);
	});

	it("should execute tool calls and append tool result messages", async () => {
		const client = makeMockClient([
			[{ toolCalls: [{ id: "call-1", name: "test_tool", arguments: {} }], done: false }, { done: true }],
			[{ content: "answer", done: false }, { done: true }],
		]);
		const { config, messages } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		expect(result.content).toBe("answer");
		// running display + completed display chunks
		expect(chunks.filter((c) => c.toolExecutions && c.toolExecutions.length > 0).length).toBeGreaterThanOrEqual(2);
		// assistant message carries the toolCalls
		expect(messages.some((m) => m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0)).toBe(true);
		// tool result message appended to the conversation
		expect(messages.some((m) => m.role === "tool")).toBe(true);
	});

	it("should filter tool-call JSON from displayed content", async () => {
		const toolCallJson = '{"name":"test_tool","arguments":{"input":"x"}}';
		const client = makeMockClient([
			[{ content: toolCallJson, done: false }, { content: "visible", done: false }, { done: true }],
		]);
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		const displayed = chunks.map((c) => c.content).join("");
		expect(displayed).not.toContain(toolCallJson);
		expect(displayed).toContain("visible");
		expect(result.content).toBe("visible");
	});

	it("should yield an error chunk when the LLM stream throws", async () => {
		const client: LLMClient = {
			async chat() {
				return { content: "mock", finishReason: "stop" };
			},
			async *stream(): AsyncGenerator<ProviderStreamChunk, void, unknown> {
				yield { content: "partial", done: false };
				throw new Error("boom");
			},
			async getCapabilities(): Promise<ModelCapabilities> {
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
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		const errorChunk = chunks.find((c) => c.content.includes("Error during LLM stream"));
		expect(errorChunk?.done).toBe(true);
		expect(errorChunk?.content).toContain("boom");
		expect(result.content).toBe("partial");
	});

	it("should rethrow AbortError from the LLM stream", async () => {
		const client: LLMClient = {
			async chat() {
				return { content: "mock", finishReason: "stop" };
			},
			async *stream(): AsyncGenerator<ProviderStreamChunk, void, unknown> {
				yield { done: false };
				throw new DOMException("Aborted", "AbortError");
			},
			async getCapabilities(): Promise<ModelCapabilities> {
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
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		await expect(collect(processor)).rejects.toMatchObject({ name: "AbortError" });
	});

	it("should abort when the signal is already aborted", async () => {
		const client = makeMockClient([[{ done: true }]]);
		const { config } = makeHarness(client, { signal: AbortSignal.abort() });
		const processor = new StreamProcessor(config);

		await expect(collect(processor)).rejects.toMatchObject({ name: "AbortError" });
	});

	it("should stop at max iterations and mark maxIterationsReached", async () => {
		const client = makeMockClient([
			[{ toolCalls: [{ id: "call-1", name: "test_tool", arguments: {} }], done: false }, { done: true }],
			[{ toolCalls: [{ id: "call-2", name: "test_tool", arguments: {} }], done: false }, { done: true }],
		]);
		const { config } = makeHarness(client, { maxIterations: 2 });
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		const finalChunk = chunks[chunks.length - 1];
		expect(finalChunk?.maxIterationsReached).toBe(true);
		expect(finalChunk?.done).toBe(true);
		expect(result.iterations).toBe(2);
	});

	it("should generate a final answer when the loop breaks (tool not found)", async () => {
		const client = makeMockClient([
			[{ toolCalls: [{ id: "call-1", name: "missing_tool", arguments: {} }], done: false }, { done: true }],
			[{ content: "final answer", done: false }, { done: true }],
		]);
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks, result } = await collect(processor);

		expect(result.content).toBe("final answer");
		expect(chunks.some((c) => c.content === "final answer")).toBe(true);
	});

	it("should attach observability metadata to the final chunk", async () => {
		const client = makeMockClient([[{ content: "done", done: false }, { done: true }]]);
		const { config } = makeHarness(client);
		const processor = new StreamProcessor(config);

		const { chunks } = await collect(processor);

		const finalChunk = chunks[chunks.length - 1];
		expect(finalChunk?.observability).toBeDefined();
		expect(finalChunk?.observability?.traceId).toBeDefined();
		expect(typeof finalChunk?.observability?.estimatedCostUsd).toBe("number");
	});

	it("should save history with the assistant message on completion", async () => {
		const client = makeMockClient([[{ content: "answer", done: false }, { done: true }]]);
		const { config, onSaveHistory } = makeHarness(client);
		const processor = new StreamProcessor(config);

		await collect(processor);

		expect(onSaveHistory).toHaveBeenCalledTimes(1);
		const saved = onSaveHistory.mock.calls[0]?.[0] as Message[];
		expect(saved.some((m) => m.role === "assistant" && m.content === "answer")).toBe(true);
	});
});
