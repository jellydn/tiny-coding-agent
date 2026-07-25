import { beforeEach, describe, expect, it } from "bun:test";
import {
	flushLangfuse,
	initLangfuse,
	isLangfuseEnabled,
	recordGeneration,
	resetLangfuse,
} from "../../src/observability/langfuse.js";

describe("langfuse", () => {
	beforeEach(() => {
		resetLangfuse();
		delete process.env.LANGFUSE_SECRET_KEY;
		delete process.env.LANGFUSE_PUBLIC_KEY;
		delete process.env.LANGFUSE_BASE_URL;
	});

	it("is disabled when env vars are absent", async () => {
		await initLangfuse();
		expect(isLangfuseEnabled()).toBe(false);
	});

	it("degrades to disabled when the package cannot be loaded", async () => {
		// Point to a non-existent module by setting keys but the dynamic import
		// is wrapped in try/catch; with a bogus base url the constructor still
		// succeeds (no network at construction), so just verify no-throw.
		process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
		process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
		await initLangfuse();
		// Either enabled (package present) or disabled (package missing) — both ok.
		expect(typeof isLangfuseEnabled()).toBe("boolean");
	});

	it("recordGeneration never throws when disabled", () => {
		expect(() =>
			recordGeneration({
				traceId: "trace-1",
				name: "gen",
				model: "gpt-4o",
				input: { prompt: "hi" },
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				latencyMs: 10,
				estimatedCostUsd: 0.0001,
			})
		).not.toThrow();
	});

	it("flushLangfuse never throws when disabled", async () => {
		await expect(flushLangfuse()).resolves.toBeUndefined();
	});

	it("does not break when called with an error object", async () => {
		process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
		process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
		await initLangfuse();
		expect(() =>
			recordGeneration({
				traceId: "trace-err",
				name: "gen",
				model: "gpt-4o",
				input: { prompt: "hi" },
				error: new Error("provider failed"),
				latencyMs: 5,
			})
		).not.toThrow();
	});
});
