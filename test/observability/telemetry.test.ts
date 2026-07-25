import { beforeEach, describe, expect, it } from "bun:test";
import {
	initTelemetry,
	isTelemetryEnabled,
	setUsageAttributes,
	shutdownTelemetry,
	startSpan,
} from "../../src/observability/telemetry.js";
import { runWithContext } from "../../src/observability/trace-context.js";

describe("telemetry", () => {
	beforeEach(() => {
		initTelemetry({ disabled: true });
	});

	it("is disabled when configured off", () => {
		expect(isTelemetryEnabled()).toBe(false);
	});

	it("returns a no-op span handle when disabled that never throws", async () => {
		await runWithContext("trace-disabled", async () => {
			const span = startSpan("test.span");
			expect(span.span).toBeUndefined();
			expect(() => {
				span.setAttribute("ai.model", "gpt-4o");
				span.setAttributes({ "ai.input_tokens": 10 });
				span.recordError(new Error("boom"));
				span.end(new Error("boom"));
			}).not.toThrow();
		});
	});

	it("setUsageAttributes does not throw on undefined usage", async () => {
		await runWithContext("trace-usage", async () => {
			const span = startSpan("llm.request");
			expect(() => setUsageAttributes(span, undefined)).not.toThrow();
			expect(() => setUsageAttributes(span, { inputTokens: 5, outputTokens: 3, totalTokens: 8 }, 0.0001)).not.toThrow();
			span.end();
		});
	});

	it("span operations never throw even with a broken processor", async () => {
		// Re-init with a processor that throws on every call.
		const broken = {
			onStart() {
				throw new Error("processor broken");
			},
			onEnd() {
				throw new Error("processor broken");
			},
			forceFlush: async () => {},
			shutdown: async () => {},
		};
		initTelemetry({ spanProcessors: [broken as never] });
		await runWithContext("trace-broken", async () => {
			expect(() => {
				const span = startSpan("broken.span", { "ai.model": "gpt-4o" });
				span.setAttribute("ai.input_tokens", 1);
				span.end();
			}).not.toThrow();
		});
		await shutdownTelemetry();
	});
});
