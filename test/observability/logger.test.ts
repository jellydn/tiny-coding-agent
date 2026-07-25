import { beforeEach, describe, expect, it } from "bun:test";
import { buildLogRecord, configureLogger, logEvent, sanitizeError } from "../../src/observability/logger.js";
import { runWithContext } from "../../src/observability/trace-context.js";

describe("logger", () => {
	beforeEach(() => {
		configureLogger({ logFullPrompts: false, previewLength: 200, level: "info" });
	});

	it("emits a redacted prompt preview by default", () => {
		const record = buildLogRecord({ event: "llm.request", prompt: `secret prompt ${"x".repeat(300)}` });
		expect(record.promptPreview).toBeDefined();
		expect(record.prompt).toBeUndefined();
		expect((record.promptPreview as string).endsWith("…")).toBe(true);
	});

	it("logs full prompt only when logFullPrompts is enabled", () => {
		configureLogger({ logFullPrompts: true });
		const long = "x".repeat(300);
		const record = buildLogRecord({ event: "llm.request", prompt: long });
		expect(record.prompt).toBe(long);
		expect(record.promptPreview).toBeUndefined();
	});

	it("records token usage fields when present", () => {
		const record = buildLogRecord({
			event: "llm.request",
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		});
		expect(record.inputTokens).toBe(10);
		expect(record.outputTokens).toBe(5);
		expect(record.totalTokens).toBe(15);
	});

	it("marks usage as unavailable when the provider returned nothing", () => {
		const record = buildLogRecord({ event: "llm.request", usage: undefined });
		expect(record.usage).toBeUndefined();
		// when usage object is present but empty
		const record2 = buildLogRecord({ event: "llm.request", usage: {} });
		expect(record2.usage).toBe("unavailable");
	});

	it("picks up the traceId from the active trace context", async () => {
		await runWithContext("trace-from-context", async () => {
			const record = buildLogRecord({ event: "request.start" });
			expect(record.traceId).toBe("trace-from-context");
		});
	});

	it("uses an explicit traceId over the context", async () => {
		await runWithContext("context-trace", async () => {
			const record = buildLogRecord({ event: "request.start", traceId: "explicit-trace" });
			expect(record.traceId).toBe("explicit-trace");
		});
	});

	it("redacts extra sensitive fields", () => {
		const record = buildLogRecord({
			event: "tool.execution",
			headers: { authorization: "Bearer secret", model: "gpt-4o" },
		});
		expect((record.headers as Record<string, unknown>).authorization).toBe("[REDACTED]");
		expect((record.headers as Record<string, unknown>).model).toBe("gpt-4o");
	});

	it("sanitizeError never includes a stack trace", () => {
		const err = new Error("request failed while processing");
		err.stack = "Error: request failed while processing\n    at somewhere/file.ts:10:5";
		const { errorType, errorMessage } = sanitizeError(err);
		expect(errorType).toBe("Error");
		expect(errorMessage).not.toContain("at somewhere");
		expect(errorMessage).not.toContain("file.ts");
	});

	it("sink failures do not throw", () => {
		configureLogger({
			sink: () => {
				throw new Error("sink broken");
			},
		});
		expect(() => logEvent({ event: "request.start" })).not.toThrow();
	});
});
