import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { buildContextStats, calculateMessageTokens, prepareContext } from "../../src/core/context-budget.js";
import { MemoryStore } from "../../src/core/memory.js";
import type { Message } from "../../src/providers/types.js";

const TEMP_MEMORY = "/tmp/test-context-budget-memory.json";

describe("calculateMessageTokens", () => {
	it("returns 0 for empty array", () => {
		expect(calculateMessageTokens([])).toBe(0);
	});

	it("sums content tokens across messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello world" },
			{ role: "assistant", content: "hi there" },
		];
		// countTokensSync uses ceil(length/4)
		// "hello world" = 11 chars → 3 tokens
		// "hi there" = 8 chars → 2 tokens
		expect(calculateMessageTokens(messages)).toBe(5);
	});

	it("ignores toolCalls and toolCallId", () => {
		const messages: Message[] = [
			{ role: "assistant", content: "ok", toolCalls: [{ id: "1", name: "foo", arguments: {} }] },
		];
		// "ok" = 2 chars → 1 token
		expect(calculateMessageTokens(messages)).toBe(1);
	});
});

describe("buildContextStats", () => {
	it("builds stats from current state", () => {
		const messages: Message[] = [{ role: "user", content: "hello world" }];
		const stats = buildContextStats({
			systemTokens: 100,
			memoryTokens: 50,
			messages,
			truncationApplied: false,
			maxContextTokens: 1000,
		});
		expect(stats.systemPromptTokens).toBe(100);
		expect(stats.memoryTokens).toBe(50);
		expect(stats.conversationTokens).toBe(3); // "hello world" = 3 tokens
		expect(stats.totalTokens).toBe(153);
		expect(stats.maxContextTokens).toBe(1000);
		expect(stats.truncationApplied).toBe(false);
		expect(stats.memoryCount).toBe(0);
	});

	it("reflects truncation flag", () => {
		const stats = buildContextStats({
			systemTokens: 10,
			memoryTokens: 0,
			messages: [{ role: "user", content: "hi" }],
			truncationApplied: true,
			maxContextTokens: 100,
		});
		expect(stats.truncationApplied).toBe(true);
	});
});

describe("prepareContext", () => {
	describe("Branch 1: no maxContextTokens", () => {
		it("counts tokens without truncation", async () => {
			const messages: Message[] = [{ role: "user", content: "hello world" }];
			const result = await prepareContext({
				systemPrompt: "You are a helpful assistant.",
				userPrompt: "hello world",
				messages,
			});

			expect(result.messages).toBe(messages);
			expect(result.truncationApplied).toBe(false);
			expect(result.memoryTokensUsed).toBe(0);
			expect(result.stats.truncationApplied).toBe(false);
			expect(result.stats.memoryTokens).toBe(0);
			expect(result.stats.maxContextTokens).toBe(0);
			// systemPrompt = "You are a helpful assistant." = 26 chars → 7 tokens
			expect(result.systemTokens).toBe(7);
			expect(result.stats.systemPromptTokens).toBe(7);
			expect(result.stats.conversationTokens).toBe(3);
			expect(result.stats.totalTokens).toBe(10);
		});

		it("returns original messages unchanged", async () => {
			const messages: Message[] = [
				{ role: "user", content: "first" },
				{ role: "assistant", content: "second" },
				{ role: "user", content: "third" },
			];
			const result = await prepareContext({
				systemPrompt: "system",
				userPrompt: "third",
				messages,
			});
			expect(result.messages).toHaveLength(3);
			expect(result.messages[0]?.content).toBe("first");
		});
	});

	describe("Branch 2: maxContextTokens + memory store", () => {
		beforeEach(() => {
			try {
				unlinkSync(TEMP_MEMORY);
			} catch {
				/* ignore */
			}
		});

		afterEach(() => {
			try {
				unlinkSync(TEMP_MEMORY);
			} catch {
				/* ignore */
			}
		});

		it("retrieves memories and builds context with budget", async () => {
			const store = new MemoryStore({ filePath: TEMP_MEMORY, maxMemories: 10, autoLoad: false });
			store.add("TypeScript is used", "project");
			store.add("Bun is the runtime", "project");

			const messages: Message[] = [{ role: "user", content: "what language is used?" }];
			const result = await prepareContext({
				systemPrompt: "You are a helpful assistant.",
				userPrompt: "what language is used?",
				messages,
				maxContextTokens: 10000,
				memoryStore: store,
				memoryBudgetPercent: 0.2,
			});

			// Should have at least system + memory context + conversation messages
			expect(result.messages.length).toBeGreaterThan(0);
			expect(result.stats.memoryTokens).toBeGreaterThan(0);
			expect(result.stats.maxContextTokens).toBeGreaterThan(0);
			expect(result.systemTokens).toBe(7);
		});

		it("invokes wrapRetrieval hook on success", async () => {
			const store = new MemoryStore({ filePath: TEMP_MEMORY, maxMemories: 10, autoLoad: false });
			store.add("test memory", "user");

			let capturedCount: number | undefined;
			let capturedError: unknown = "sentinel";

			const result = await prepareContext({
				systemPrompt: "system",
				userPrompt: "test",
				messages: [{ role: "user", content: "test" }],
				maxContextTokens: 10000,
				memoryStore: store,
				wrapRetrieval: () => (count: number, error?: unknown) => {
					capturedCount = count;
					capturedError = error;
				},
			});

			expect(result.messages.length).toBeGreaterThan(0);
			expect(capturedCount).toBeGreaterThan(0);
			expect(capturedError).toBeUndefined();
		});

		it("invokes wrapRetrieval hook on error and rethrows", async () => {
			// Use a broken memoryStore by overriding findRelevant
			const store = new MemoryStore({ filePath: TEMP_MEMORY, maxMemories: 10, autoLoad: false });
			store.add("irrelevant", "user");
			// Monkey-patch to throw
			const originalFind = store.findRelevant.bind(store);
			store.findRelevant = () => {
				throw new Error("retrieval exploded");
			};

			let capturedCount: number | undefined;
			let capturedError: unknown = "sentinel";

			await expect(
				prepareContext({
					systemPrompt: "system",
					userPrompt: "test",
					messages: [{ role: "user", content: "test" }],
					maxContextTokens: 10000,
					memoryStore: store,
					wrapRetrieval: () => (count: number, error?: unknown) => {
						capturedCount = count;
						capturedError = error;
					},
				})
			).rejects.toThrow("retrieval exploded");

			// The hook should have been called with count=0 and the error
			expect(capturedCount).toBe(0);
			expect(capturedError).toBeInstanceOf(Error);
			expect((capturedError as Error).message).toBe("retrieval exploded");

			// Restore for cleanup
			store.findRelevant = originalFind;
		});

		it("works without wrapRetrieval hook (errors propagate directly)", async () => {
			const store = new MemoryStore({ filePath: TEMP_MEMORY, maxMemories: 10, autoLoad: false });
			store.add("irrelevant", "user");
			store.findRelevant = () => {
				throw new Error("direct error");
			};

			await expect(
				prepareContext({
					systemPrompt: "system",
					userPrompt: "test",
					messages: [{ role: "user", content: "test" }],
					maxContextTokens: 10000,
					memoryStore: store,
				})
			).rejects.toThrow("direct error");
		});
	});

	describe("Branch 3: maxContextTokens without memory store", () => {
		it("truncates messages when over budget", async () => {
			// Create many large messages (~275 tokens each)
			const messages: Message[] = [];
			for (let i = 0; i < 50; i++) {
				messages.push({ role: "user", content: `Message ${i} `.repeat(100) });
			}

			// availableTokens = 1200 - 2 (system) - 1000 (reserve) = 198
			// 50 messages × ~275 tokens = ~13750 tokens >> 198 → truncation
			const result = await prepareContext({
				systemPrompt: "system",
				userPrompt: "test",
				messages,
				maxContextTokens: 1200,
			});

			expect(result.truncationApplied).toBe(true);
			expect(result.messages.length).toBeLessThan(50);
			expect(result.stats.truncationApplied).toBe(true);
		});

		it("does not truncate when under budget", async () => {
			const messages: Message[] = [
				{ role: "user", content: "short" },
				{ role: "assistant", content: "reply" },
			];

			const result = await prepareContext({
				systemPrompt: "system",
				userPrompt: "short",
				messages,
				maxContextTokens: 10000, // plenty of room
			});

			expect(result.truncationApplied).toBe(false);
			expect(result.messages.length).toBe(2);
			expect(result.stats.truncationApplied).toBe(false);
		});

		it("handles zero available tokens gracefully", async () => {
			const messages: Message[] = [{ role: "user", content: "hello" }];

			// maxContextTokens = systemTokens + 1000 → availableTokens = 0
			// "system" = 6 chars → 2 tokens, so maxContextTokens = 1002
			const result = await prepareContext({
				systemPrompt: "system",
				userPrompt: "hello",
				messages,
				maxContextTokens: 1002,
			});

			// availableTokens = 1002 - 2 - 1000 = 0, so no truncation
			expect(result.truncationApplied).toBe(false);
			expect(result.messages).toBe(messages);
		});
	});
});
