import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DebugLogger } from "../../src/core/debug-logger.js";
import type { ContextStats } from "../../src/core/memory.js";

describe("DebugLogger", () => {
	let logSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		logSpy = spyOn(console, "log").mockReturnValue(undefined);
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	describe("verbose = false (no-op)", () => {
		const logger = new DebugLogger(false);

		it("logRequestDetails should not log anything", () => {
			logger.logRequestDetails({
				providerType: "openai",
				model: "gpt-4o",
				systemPromptLength: 100,
				messageCount: 2,
				toolCount: 5,
			});
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("logIteration should not log anything", () => {
			const stats: ContextStats = {
				systemPromptTokens: 50,
				memoryTokens: 0,
				conversationTokens: 100,
				totalTokens: 150,
				maxContextTokens: 8000,
				truncationApplied: false,
				memoryCount: 0,
			};
			logger.logIteration(0, stats, true);
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("logLlmResponse should not log anything", () => {
			logger.logLlmResponse("hello world", []);
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("logAgentFinished should not log anything", () => {
			logger.logAgentFinished(3);
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("logLoopDetected should not log anything", () => {
			logger.logLoopDetected();
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("logMaxIterations should not log anything", () => {
			logger.logMaxIterations(20);
			expect(logSpy).not.toHaveBeenCalled();
		});
	});

	describe("verbose = true", () => {
		const logger = new DebugLogger(true);

		describe("logRequestDetails", () => {
			it("should log basic request details", () => {
				logger.logRequestDetails({
					providerType: "openai",
					model: "gpt-4o",
					systemPromptLength: 500,
					messageCount: 3,
					toolCount: 7,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Provider: openai");
				expect(output).toContain("Model: gpt-4o");
				expect(output).toContain("System prompt length: 500");
				expect(output).toContain("Messages: 3");
				expect(output).toContain("Tools: 7");
			});

			it("should log provider config with redacted API key", () => {
				logger.logRequestDetails({
					providerType: "anthropic",
					model: "claude-sonnet-4",
					providerConfig: { apiKey: "sk-ant-12345678abcdef", baseUrl: "https://custom.api.com" },
					systemPromptLength: 200,
					messageCount: 1,
					toolCount: 0,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("baseUrl=https://custom.api.com");
				expect(output).toContain("apiKey=sk-a...REDACTED");
				expect(output).not.toContain("sk-ant-12345678abcdef");
			});

			it("should log provider config with '(not set)' for missing API key", () => {
				logger.logRequestDetails({
					providerType: "ollama",
					model: "qwen3-coder",
					providerConfig: { baseUrl: "http://localhost:11434" },
					systemPromptLength: 100,
					messageCount: 1,
					toolCount: 0,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("apiKey=(not set)");
			});

			it("should log thinking config when present", () => {
				logger.logRequestDetails({
					providerType: "openai",
					model: "gpt-4o",
					thinking: { enabled: true, effort: "high" },
					systemPromptLength: 100,
					messageCount: 1,
					toolCount: 0,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Thinking config: enabled=true, effort=high");
			});

			it("should log memory count when present", () => {
				logger.logRequestDetails({
					providerType: "openai",
					model: "gpt-4o",
					systemPromptLength: 100,
					messageCount: 1,
					toolCount: 0,
					memoryCount: 42,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Memory entries: 42");
			});

			it("should log 0 memory count when not present", () => {
				logger.logRequestDetails({
					providerType: "openai",
					model: "gpt-4o",
					systemPromptLength: 100,
					messageCount: 1,
					toolCount: 0,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Memory entries: 0");
			});

			it("should log (unlimited) for missing maxContextTokens", () => {
				logger.logRequestDetails({
					providerType: "openai",
					model: "gpt-4o",
					systemPromptLength: 100,
					messageCount: 1,
					toolCount: 0,
				});

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Max context tokens: (unlimited)");
			});
		});

		describe("logIteration", () => {
			const stats: ContextStats = {
				systemPromptTokens: 50,
				memoryTokens: 20,
				conversationTokens: 100,
				totalTokens: 170,
				maxContextTokens: 8000,
				truncationApplied: false,
				memoryCount: 2,
			};

			it("should log iteration number", () => {
				logger.logIteration(0, stats, false);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Iteration 1");
			});

			it("should log context stats when trackContextUsage is true", () => {
				logger.logIteration(2, stats, true);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Context: 170/8000 tokens");
				expect(output).toContain("system=50");
				expect(output).toContain("memory=20");
				expect(output).toContain("conversation=100");
			});

			it("should not log context stats when trackContextUsage is false", () => {
				logger.logIteration(0, stats, false);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).not.toContain("Context:");
			});

			it("should log truncation warning when applied", () => {
				const truncatedStats: ContextStats = { ...stats, truncationApplied: true };
				logger.logIteration(0, truncatedStats, true);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Truncation applied");
			});
		});

		describe("logLlmResponse", () => {
			it("should log response length", () => {
				logger.logLlmResponse("Hello, world!", []);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("13 chars");
			});

			it("should log tool calls when present", () => {
				logger.logLlmResponse("Using tools now", ["read_file", "write_file"]);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Tool calls: read_file, write_file");
			});

			it("should not log tool calls when empty", () => {
				logger.logLlmResponse("No tools needed", []);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).not.toContain("Tool calls:");
			});
		});

		describe("logAgentFinished", () => {
			it("should log iteration count", () => {
				logger.logAgentFinished(3);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Agent finished");
				expect(output).toContain("3 iteration(s)");
			});
		});

		describe("logLoopDetected", () => {
			it("should log loop detection warning", () => {
				logger.logLoopDetected();

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Loop detected");
			});
		});

		describe("logMaxIterations", () => {
			it("should log max iterations reached", () => {
				logger.logMaxIterations(20);

				const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
				expect(output).toContain("Max iterations (20) reached");
			});
		});
	});

	describe("API key redaction", () => {
		it("should redact keys longer than 8 chars", () => {
			const logger = new DebugLogger(true);
			logger.logRequestDetails({
				providerType: "test",
				model: "test-model",
				providerConfig: { apiKey: "sk-verylongkey123" },
				systemPromptLength: 1,
				messageCount: 1,
				toolCount: 0,
			});

			const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
			expect(output).toContain("sk-v...REDACTED");
			expect(output).not.toContain("sk-verylongkey123");
		});

		it("should mask short keys with ****", () => {
			const logger = new DebugLogger(true);
			logger.logRequestDetails({
				providerType: "test",
				model: "test-model",
				providerConfig: { apiKey: "short" },
				systemPromptLength: 1,
				messageCount: 1,
				toolCount: 0,
			});

			const output = logSpy.mock.calls.map((c: string[]) => c[0]).join("\n");
			expect(output).toContain("****");
		});
	});
});
