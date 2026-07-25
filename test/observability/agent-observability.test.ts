import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent } from "../../src/core/agent.js";
import { resetLangfuse } from "../../src/observability/langfuse.js";
import { configureLogger } from "../../src/observability/logger.js";
import { initTelemetry, shutdownTelemetry } from "../../src/observability/telemetry.js";
import type {
	ChatOptions,
	ChatResponse,
	LLMClient,
	StreamChunk,
	TokenUsage,
	ToolCall,
} from "../../src/providers/types.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { Tool } from "../../src/tools/types.js";

// Silence console telemetry + capture structured log lines.
let logLines: Array<Record<string, unknown>> = [];
const sink = (line: string): void => {
	try {
		logLines.push(JSON.parse(line) as Record<string, unknown>);
	} catch {
		// ignore non-JSON
	}
};

function resetLogs(): void {
	logLines = [];
}

beforeEach(() => {
	resetLogs();
	configureLogger({ logFullPrompts: false, previewLength: 200, sink, level: "info" });
	initTelemetry({ disabled: true });
	resetLangfuse();
});

afterEach(async () => {
	await shutdownTelemetry();
});

/** Mock client with configurable behavior across sequential stream() calls. */
class SequenceMockClient implements LLMClient {
	private _call = 0;
	constructor(
		private readonly _scripts: Array<{
			content?: string;
			toolCalls?: ToolCall[];
			usage?: TokenUsage;
			throw?: Error;
		}>
	) {}

	async chat(_options: ChatOptions): Promise<ChatResponse> {
		return { content: "mock", finishReason: "stop" };
	}

	async *stream(_options: ChatOptions): AsyncGenerator<StreamChunk, void, unknown> {
		const script = this._scripts[this._call++] ?? this._scripts[this._scripts.length - 1] ?? {};
		if (script.throw) throw script.throw;
		if (script.toolCalls) {
			yield { toolCalls: script.toolCalls, done: false };
		}
		if (script.content) {
			yield { content: script.content, done: false };
		}
		yield { done: true, usage: script.usage };
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

const echoTool: Tool = {
	name: "echo",
	description: "Echo back the input",
	parameters: { type: "object", properties: { text: {} }, required: ["text"] },
	async execute(args) {
		return { success: true, output: String(args.text ?? "") };
	},
};

function newRegistry(): ToolRegistry {
	const reg = new ToolRegistry();
	reg.register(echoTool);
	return reg;
}

/** Drain an agent run stream and return the final observability metadata. */
async function runAgent(
	client: LLMClient,
	prompt: string,
	registry: ToolRegistry = newRegistry()
): Promise<{
	content: string;
	meta?: { traceId: string; latencyMs: number; usage?: TokenUsage; estimatedCostUsd: number };
}> {
	const agent = new Agent(client, registry, {
		observability: { telemetryEnabled: false, langfuseEnabled: false },
	});
	let content = "";
	let meta: { traceId: string; latencyMs: number; usage?: TokenUsage; estimatedCostUsd: number } | undefined;
	for await (const chunk of agent.runStream(prompt, "mock-model")) {
		content += chunk.content;
		if (chunk.done && chunk.observability) meta = chunk.observability;
	}
	return { content, meta };
}

describe("agent observability", () => {
	it("records latency and token usage for a successful LLM request", async () => {
		const client = new SequenceMockClient([
			{ content: "hello world", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
		]);
		const { meta } = await runAgent(client, "say hi");
		expect(meta).toBeDefined();
		expect(meta!.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(meta!.latencyMs).toBeGreaterThanOrEqual(0);
		expect(meta!.usage?.inputTokens).toBe(10);
		expect(meta!.usage?.outputTokens).toBe(5);
		expect(meta!.usage?.totalTokens).toBe(15);
		expect(meta!.estimatedCostUsd).toBeGreaterThan(0);

		const llmEvents = logLines.filter((l) => l.event === "llm.request");
		expect(llmEvents.length).toBe(1);
		expect(llmEvents[0]?.inputTokens).toBe(10);
		expect(llmEvents[0]?.outputTokens).toBe(5);
		expect(llmEvents[0]?.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("records the error against the correct trace on a failed request", async () => {
		const client = new SequenceMockClient([{ throw: new Error("provider exploded") }]);
		await expect(runAgent(client, "boom")).rejects.toThrow("provider exploded");

		const errorEvents = logLines.filter((l) => l.event === "request.error");
		expect(errorEvents.length).toBe(1);
		const errEvent = errorEvents[0]!;
		expect(errEvent.status).toBe("error");
		expect(errEvent.errorType).toBe("Error");
		expect(String(errEvent.errorMessage)).not.toContain("provider exploded");
		expect(errEvent.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(errEvent.latencyMs).toBeGreaterThanOrEqual(0);

		// request.end must reflect the failure, not "ok".
		const endEvents = logLines.filter((l) => l.event === "request.end");
		expect(endEvents.length).toBe(1);
		expect(endEvents[0]?.status).toBe("error");
		expect(endEvents[0]?.traceId).toBe(errEvent.traceId);
	});

	it("propagates the same trace id through retrieval, tools, and LLM calls", async () => {
		const toolCall: ToolCall = { id: "call-1", name: "echo", arguments: { text: "trace" } };
		const client = new SequenceMockClient([
			{ toolCalls: [toolCall], usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } },
			{ content: "done", usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 } },
		]);
		const { meta } = await runAgent(client, "use echo then answer");

		expect(meta).toBeDefined();
		const traceId = meta!.traceId;

		// Every logged event in this run shares the same trace id.
		const eventsWithTrace = logLines.filter((l) => typeof l.traceId === "string" && l.traceId !== "no-trace");
		expect(eventsWithTrace.length).toBeGreaterThan(0);
		const distinctTraces = new Set(eventsWithTrace.map((l) => l.traceId));
		expect(distinctTraces.size).toBe(1);
		expect(distinctTraces.has(traceId)).toBe(true);

		// And the expected event types all appear.
		const events = new Set(eventsWithTrace.map((l) => l.event));
		expect(events.has("llm.request")).toBe(true);
		expect(events.has("tool.execution")).toBe(true);
		expect(events.has("request.start")).toBe(true);
		expect(events.has("request.end")).toBe(true);
	});

	it("handles missing provider usage data safely", async () => {
		const client = new SequenceMockClient([{ content: "no usage here" /* no usage */ }]);
		const { meta } = await runAgent(client, "anything");
		expect(meta).toBeDefined();
		// Usage is unavailable (undefined), not fabricated.
		expect(meta!.usage).toBeUndefined();
		// Cost estimate is zero (no data), never NaN.
		expect(meta!.estimatedCostUsd).toBe(0);
		expect(Number.isFinite(meta!.estimatedCostUsd)).toBe(true);

		const llmEvents = logLines.filter((l) => l.event === "llm.request");
		expect(llmEvents[0]?.usage).toBe("unavailable");
	});

	it("redacts sensitive fields and never logs full prompts by default", async () => {
		const secretPrompt = "My API key is sk-abcdef1234567890 and password is hunter2";
		const client = new SequenceMockClient([{ content: "ok" }]);
		await runAgent(client, secretPrompt);

		const startEvents = logLines.filter((l) => l.event === "request.start");
		expect(startEvents.length).toBe(1);
		const raw = JSON.stringify(startEvents[0]);
		// Full prompt must not appear verbatim.
		expect(raw).not.toContain("hunter2");
		expect(raw).not.toContain("sk-abcdef1234567890");
		// Only a preview field is present.
		expect(startEvents[0]?.prompt).toBeUndefined();
		expect(startEvents[0]?.promptPreview).toBeDefined();
	});

	it("concurrent requests do not mix trace contexts", async () => {
		const makeClient = () =>
			new SequenceMockClient([{ content: "a", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }]);

		const N = 5;
		const results = await Promise.all(Array.from({ length: N }, (_, i) => runAgent(makeClient(), `prompt-${i}`)));

		const traceIds = results.map((r) => r.meta!.traceId);
		// All trace ids are unique.
		expect(new Set(traceIds).size).toBe(N);

		// Each trace has exactly one request.start and one request.end.
		for (const id of traceIds) {
			const starts = logLines.filter((l) => l.event === "request.start" && l.traceId === id);
			const ends = logLines.filter((l) => l.event === "request.end" && l.traceId === id);
			expect(starts.length).toBe(1);
			expect(ends.length).toBe(1);
		}
		// No event was logged with the fallback "no-trace" id.
		const noTrace = logLines.filter((l) => l.traceId === "no-trace");
		expect(noTrace.length).toBe(0);
	});

	it("does not break the request when telemetry/exporter failures occur", async () => {
		// Re-enable telemetry with a processor that throws on every hook.
		const broken = {
			onStart() {
				throw new Error("boom-start");
			},
			onEnd() {
				throw new Error("boom-end");
			},
			forceFlush: async () => {
				throw new Error("boom-flush");
			},
			shutdown: async () => {
				throw new Error("boom-shutdown");
			},
		};
		initTelemetry({ spanProcessors: [broken as never] });

		const client = new SequenceMockClient([
			{ content: "still works", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } },
		]);
		const { meta, content } = await runAgent(client, "resilient");
		expect(content).toBe("still works");
		expect(meta).toBeDefined();
		expect(meta!.usage?.totalTokens).toBe(3);
	});
});
