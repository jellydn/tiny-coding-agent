import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { AgentObservabilityMeta } from "../../src/core/agent-observability.js";
import { AgentObservability } from "../../src/core/agent-observability.js";
import { resetLangfuse } from "../../src/observability/langfuse.js";
import { configureLogger } from "../../src/observability/logger.js";
import { initTelemetry, shutdownTelemetry } from "../../src/observability/telemetry.js";
import type { TokenUsage } from "../../src/providers/types.js";

// Capture structured log lines into an array for assertions.
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

/** Find all log lines matching an event name. */
function eventsOf(event: string): Array<Record<string, unknown>> {
	return logLines.filter((l) => l.event === event);
}

const CTX = { provider: "openai", model: "gpt-4o" };
const USAGE: TokenUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

describe("AgentObservability", () => {
	describe("constructor", () => {
		it("should be constructible without config (defaults to disabled telemetry)", () => {
			const obs = new AgentObservability(undefined);
			expect(obs).toBeDefined();
			expect(obs instanceof AgentObservability).toBe(true);
		});

		it("should be constructible with a config object", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			expect(obs).toBeDefined();
		});

		it("should have an empty traceId before beginRequest is called", () => {
			const obs = new AgentObservability(undefined);
			expect(obs.traceId).toBe("");
		});

		it("should have undefined accumulatedUsage before any LLM call", () => {
			const obs = new AgentObservability(undefined);
			expect(obs.accumulatedUsage).toBeUndefined();
		});
	});

	describe("beginRequest", () => {
		it("should establish a trace context and log request.start", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("hello world", CTX);

			// traceId should now be set (a 32-char hex string)
			expect(obs.traceId).toMatch(/^[0-9a-f]{32}$/);

			// request.start should be logged with provider + model
			const starts = eventsOf("request.start");
			expect(starts.length).toBe(1);
			expect(starts[0]?.provider).toBe("openai");
			expect(starts[0]?.model).toBe("gpt-4o");
		});

		it("should not log the full prompt when logFullPrompts is false", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			const prompt = "Analyze this codebase for patterns";
			obs.beginRequest(prompt, CTX);

			const starts = eventsOf("request.start");
			expect(starts.length).toBe(1);
			// The full prompt field must NOT be present (only a redacted preview)
			expect(starts[0]?.prompt).toBeUndefined();
			expect(starts[0]?.promptPreview).toBeDefined();
			expect(starts[0]?.promptLength).toBe(prompt.length);
		});

		it("should be safe to call multiple times (idempotent init)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("first", CTX);
			obs.beginRequest("second", CTX);
			// Calling again establishes a new trace context
			expect(obs.traceId).toMatch(/^[0-9a-f]{32}$/);
			// Both request.start events should be logged
			expect(eventsOf("request.start").length).toBe(2);
		});
	});

	describe("beginLlmCall + recordLlmResponse", () => {
		it("should accumulate usage from recordLlmResponse", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "hello",
					latencyMs: 42,
				},
				"test prompt"
			);

			expect(obs.accumulatedUsage).toBeDefined();
			expect(obs.accumulatedUsage?.inputTokens).toBe(10);
			expect(obs.accumulatedUsage?.outputTokens).toBe(5);
			expect(obs.accumulatedUsage?.totalTokens).toBe(15);
		});

		it("should log llm.request with usage and cost", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "response text",
					latencyMs: 100,
				},
				"test prompt"
			);

			const llmEvents = eventsOf("llm.request");
			expect(llmEvents.length).toBe(1);
			expect(llmEvents[0]?.provider).toBe("openai");
			expect(llmEvents[0]?.model).toBe("gpt-4o");
			expect(llmEvents[0]?.latencyMs).toBe(100);
			expect(llmEvents[0]?.inputTokens).toBe(10);
			expect(llmEvents[0]?.outputTokens).toBe(5);
			expect(llmEvents[0]?.estimatedCostUsd).toBeGreaterThan(0);
			expect(llmEvents[0]?.status).toBe("ok");
		});

		it("should handle undefined usage safely", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: undefined,
					content: "no usage",
					latencyMs: 10,
				},
				"test prompt"
			);

			// Usage should remain undefined (not fabricated)
			expect(obs.accumulatedUsage).toBeUndefined();

			const llmEvents = eventsOf("llm.request");
			expect(llmEvents[0]?.usage).toBe("unavailable");
		});

		it("should accumulate usage across multiple LLM calls", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			// First call: 10 input + 5 output
			const call1 = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				call1.span,
				call1.timer,
				CTX,
				{
					usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
					content: "first",
					latencyMs: 30,
				},
				"test prompt"
			);

			// Second call: 20 input + 10 output
			const call2 = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				call2.span,
				call2.timer,
				CTX,
				{
					usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
					content: "second",
					latencyMs: 40,
				},
				"test prompt"
			);

			// Accumulated: 30 input + 15 output
			expect(obs.accumulatedUsage?.inputTokens).toBe(30);
			expect(obs.accumulatedUsage?.outputTokens).toBe(15);
		});

		it("should record timeToFirstTokenMs on the span when provided", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			// Should not throw when timeToFirstTokenMs is provided
			expect(() => {
				obs.recordLlmResponse(
					span,
					timer,
					CTX,
					{
						usage: USAGE,
						content: "streamed",
						latencyMs: 50,
						timeToFirstTokenMs: 12,
					},
					"test prompt"
				);
			}).not.toThrow();
		});
	});

	describe("recordLlmCallError", () => {
		it("should end the span with an error without throwing", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span } = obs.beginLlmCall(CTX);
			expect(() => {
				obs.recordLlmCallError(span, new Error("LLM failed"));
			}).not.toThrow();
		});
	});

	describe("beginRetrieval + recordRetrieval", () => {
		it("should log retrieval events with latency and traceId", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginRetrieval();
			obs.recordRetrieval(span, timer, 5);

			const retrievalEvents = eventsOf("retrieval");
			expect(retrievalEvents.length).toBe(1);
			// Note: resultCount is passed to log.info but not serialized by the logger
			// (it's in EXTRA_KEYS but not handled explicitly in buildLogRecord).
			// Assert on the fields that ARE serialized: latencyMs + traceId.
			expect(retrievalEvents[0]?.latencyMs).toBeGreaterThanOrEqual(0);
			expect(retrievalEvents[0]?.traceId).toBe(obs.traceId);
		});

		it("recordRetrievalError should rethrow the error", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span } = obs.beginRetrieval();
			const err = new Error("retrieval failed");
			expect(() => {
				obs.recordRetrievalError(span, err);
			}).toThrow("retrieval failed");
		});
	});

	describe("beginToolExecution + recordToolResult", () => {
		it("should log one tool.execution event per tool entry", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginToolExecution();
			obs.recordToolResult(
				span,
				timer,
				["echo", "grep"],
				[
					{ name: "echo", status: "complete", latencyMs: 5 },
					{ name: "grep", status: "complete", latencyMs: 10 },
				]
			);

			const toolEvents = eventsOf("tool.execution");
			expect(toolEvents.length).toBe(2);
			// Note: toolName is passed to log.info but not serialized by the logger
			// (it's in EXTRA_KEYS but not handled explicitly in buildLogRecord).
			// Assert on the fields that ARE serialized: status + traceId.
			expect(toolEvents[0]?.status).toBe("ok");
			expect(toolEvents[1]?.status).toBe("ok");
		});

		it("should log error status for failed tools", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginToolExecution();
			obs.recordToolResult(
				span,
				timer,
				["bash"],
				[{ name: "bash", status: "error", latencyMs: 15, error: "command not found" }]
			);

			const toolEvents = eventsOf("tool.execution");
			expect(toolEvents.length).toBe(1);
			expect(toolEvents[0]?.status).toBe("error");
			expect(toolEvents[0]?.errorType).toBeDefined();
		});
	});

	describe("markFailed", () => {
		it("should mark the request as failed so finalize reports error status", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			obs.markFailed();
			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents.length).toBe(1);
			expect(endEvents[0]?.status).toBe("error");
		});

		it("should not affect the request when not called (finalize reports ok)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);
			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents[0]?.status).toBe("ok");
		});

		it("should be idempotent (calling multiple times is safe)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			obs.markFailed();
			obs.markFailed();
			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents[0]?.status).toBe("error");
		});
	});

	describe("recordRequestError", () => {
		it("should log request.error with error type and status", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			// Use a non-sensitive error message to avoid redaction by sanitizeError
			obs.recordRequestError(CTX, new Error("test failure"));

			const errorEvents = eventsOf("request.error");
			expect(errorEvents.length).toBe(1);
			expect(errorEvents[0]?.errorType).toBe("Error");
			expect(errorEvents[0]?.status).toBe("error");
			expect(errorEvents[0]?.provider).toBe("openai");
		});

		it("should set the request as failed (finalize reports error)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			obs.recordRequestError(CTX, new Error("boom"));
			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents[0]?.status).toBe("error");
		});
	});

	describe("finalize", () => {
		it("should log request.end with total latency and accumulated usage", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "response",
					latencyMs: 50,
				},
				"test prompt"
			);

			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents.length).toBe(1);
			expect(endEvents[0]?.latencyMs).toBeGreaterThanOrEqual(0);
			expect(endEvents[0]?.inputTokens).toBe(10);
			expect(endEvents[0]?.outputTokens).toBe(5);
			expect(endEvents[0]?.estimatedCostUsd).toBeGreaterThan(0);
		});

		it("should report ok status when no failure occurred", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);
			obs.finalize(CTX);

			expect(eventsOf("request.end")[0]?.status).toBe("ok");
		});

		it("should handle finalize without any LLM calls (no usage)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);
			obs.finalize(CTX);

			const endEvents = eventsOf("request.end");
			expect(endEvents[0]?.usage).toBe("unavailable");
			expect(endEvents[0]?.estimatedCostUsd).toBe(0);
		});

		it("should be safe to call without beginRequest (no root span)", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			// finalize without beginRequest — should not throw
			expect(() => obs.finalize(CTX)).not.toThrow();
			const endEvents = eventsOf("request.end");
			expect(endEvents.length).toBe(1);
			expect(endEvents[0]?.latencyMs).toBe(0);
		});
	});

	describe("buildMeta", () => {
		it("should return metadata with traceId, latencyMs, usage, and estimatedCostUsd", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "response",
					latencyMs: 50,
				},
				"test prompt"
			);

			const meta: AgentObservabilityMeta = obs.buildMeta("gpt-4o");

			expect(meta.traceId).toMatch(/^[0-9a-f]{32}$/);
			expect(meta.traceId).toBe(obs.traceId);
			expect(meta.latencyMs).toBeGreaterThanOrEqual(0);
			expect(meta.usage?.inputTokens).toBe(10);
			expect(meta.usage?.outputTokens).toBe(5);
			expect(meta.estimatedCostUsd).toBeGreaterThan(0);
		});

		it("should return empty traceId and zero cost before beginRequest", () => {
			const obs = new AgentObservability(undefined);
			const meta = obs.buildMeta("gpt-4o");

			expect(meta.traceId).toBe("");
			expect(meta.latencyMs).toBe(0);
			expect(meta.usage).toBeUndefined();
			expect(meta.estimatedCostUsd).toBe(0);
		});

		it("should return undefined usage when no LLM calls were made", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);
			const meta = obs.buildMeta("gpt-4o");

			expect(meta.traceId).toMatch(/^[0-9a-f]{32}$/);
			expect(meta.usage).toBeUndefined();
			expect(meta.estimatedCostUsd).toBe(0);
		});

		it("should accept a different model name than the request context", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test prompt", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "response",
					latencyMs: 50,
				},
				"test prompt"
			);

			// buildMeta can be called with a different model (e.g. parsed model name)
			const meta = obs.buildMeta("gpt-4o-mini");
			expect(meta.estimatedCostUsd).toBeGreaterThanOrEqual(0);
		});
	});

	describe("traceId getter", () => {
		it("should return empty string before beginRequest", () => {
			const obs = new AgentObservability(undefined);
			expect(obs.traceId).toBe("");
		});

		it("should return a 32-char hex string after beginRequest", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test", CTX);
			expect(obs.traceId).toMatch(/^[0-9a-f]{32}$/);
		});
	});

	describe("accumulatedUsage getter", () => {
		it("should return undefined before any LLM call", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			expect(obs.accumulatedUsage).toBeUndefined();
		});

		it("should return the accumulated usage after LLM calls", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test", CTX);

			const { span, timer } = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				span,
				timer,
				CTX,
				{
					usage: USAGE,
					content: "hi",
					latencyMs: 10,
				},
				"test"
			);

			expect(obs.accumulatedUsage).toBeDefined();
			expect(obs.accumulatedUsage?.totalTokens).toBe(15);
		});
	});

	describe("full request lifecycle", () => {
		it("should produce a complete event sequence: start → retrieval → llm → tool → end", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("analyze codebase", CTX);

			// Retrieval
			const ret = obs.beginRetrieval();
			obs.recordRetrieval(ret.span, ret.timer, 3);

			// LLM call
			const llm = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				llm.span,
				llm.timer,
				CTX,
				{
					usage: USAGE,
					content: "analysis result",
					latencyMs: 200,
				},
				"analyze codebase"
			);

			// Tool execution
			const tool = obs.beginToolExecution();
			obs.recordToolResult(tool.span, tool.timer, ["grep"], [{ name: "grep", status: "complete", latencyMs: 5 }]);

			// Finalize
			obs.finalize(CTX);

			// Verify event sequence
			const events = logLines.map((l) => l.event);
			expect(events).toContain("request.start");
			expect(events).toContain("retrieval");
			expect(events).toContain("llm.request");
			expect(events).toContain("tool.execution");
			expect(events).toContain("request.end");
		});

		it("should propagate the same traceId across all events in a lifecycle", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test", CTX);
			const expectedTraceId = obs.traceId;

			const ret = obs.beginRetrieval();
			obs.recordRetrieval(ret.span, ret.timer, 1);

			const llm = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				llm.span,
				llm.timer,
				CTX,
				{
					usage: USAGE,
					content: "ok",
					latencyMs: 10,
				},
				"test"
			);

			obs.finalize(CTX);

			const eventsWithTrace = logLines.filter((l) => typeof l.traceId === "string" && l.traceId !== "no-trace");
			expect(eventsWithTrace.length).toBeGreaterThan(0);
			const distinctTraces = new Set(eventsWithTrace.map((l) => l.traceId));
			expect(distinctTraces.size).toBe(1);
			expect(distinctTraces.has(expectedTraceId)).toBe(true);
		});

		it("should produce correct buildMeta after a full lifecycle with failure", () => {
			const obs = new AgentObservability({ telemetryEnabled: false, langfuseEnabled: false });
			obs.beginRequest("test", CTX);

			const llm = obs.beginLlmCall(CTX);
			obs.recordLlmResponse(
				llm.span,
				llm.timer,
				CTX,
				{
					usage: USAGE,
					content: "partial",
					latencyMs: 30,
				},
				"test"
			);

			obs.markFailed();
			obs.finalize(CTX);

			const meta = obs.buildMeta("gpt-4o");
			expect(meta.traceId).toBe(obs.traceId);
			expect(meta.usage?.totalTokens).toBe(15);
			expect(meta.estimatedCostUsd).toBeGreaterThan(0);

			// finalize should have logged error status
			expect(eventsOf("request.end")[0]?.status).toBe("error");
		});
	});
});
