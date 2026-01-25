import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { calculateContextBudget, MemoryStore } from "../../src/core/memory.js";

const tempFile = "/tmp/test-memory-store.json";

beforeEach(() => {
	try {
		unlinkSync(tempFile);
	} catch {
		// Ignore if file doesn't exist
	}
});

afterEach(() => {
	try {
		unlinkSync(tempFile);
	} catch {
		// Ignore if file doesn't exist
	}
});

describe("MemoryStore", () => {
	describe("_evictIfNeeded()", () => {
		it("should evict oldest memories when over max limit", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 3 });

			store.add("memory 1");
			store.add("memory 2");
			store.add("memory 3");
			store.add("memory 4");

			expect(store.count()).toBe(3);
			expect(store.list().length).toBe(3);
		});

		it("should evict based on last accessed time", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 2 });

			store.add("first");
			store.add("second");

			store.get(store.list()[1]?.id || "");

			store.add("third");

			expect(store.count()).toBe(2);
		});
	});

	describe("findRelevant()", () => {
		it("should return memories that match the query", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });

			store.add("TypeScript is great", "project");
			store.add("JavaScript is okay", "user");
			store.add("TypeScript and JavaScript", "codebase");

			const results = store.findRelevant("TypeScript", 2);

			expect(results.length).toBe(2);
			expect(results.some((r) => r.content.includes("TypeScript and JavaScript"))).toBe(true);
		});

		it("should update access count when finding relevant memories", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });

			const memory = store.add("test memory");

			store.findRelevant("test");

			const updated = store.get(memory.id);
			expect(updated).toBeDefined();
			expect(updated?.accessCount).toBeGreaterThan(0);
		});
	});

	describe("list()", () => {
		it("should return all memories", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });

			store.add("first");
			store.add("second");
			store.add("third");

			const results = store.list();

			expect(results.length).toBe(3);
			expect(results.map((r) => r.content)).toContain("first");
			expect(results.map((r) => r.content)).toContain("second");
			expect(results.map((r) => r.content)).toContain("third");
		});

		it("should increment access count when getting a memory", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 10 });

			store.add("test memory");
			const memory = store.get(store.list()[0]?.id || "");

			expect(memory?.accessCount).toBe(1);
		});
	});
});

describe("calculateContextBudget()", () => {
	it("should return zero budgets when system prompt exceeds max", () => {
		const result = calculateContextBudget(5000, 4000, 1000);
		expect(result.memoryBudget).toBe(0);
		expect(result.conversationBudget).toBe(0);
	});

	it("should allocate 20% to memory when maxMemoryTokens not specified", () => {
		const result = calculateContextBudget(10000, 5000);
		const available = 10000 - 5000 - 1000;
		expect(result.memoryBudget).toBe(Math.floor(available * 0.2));
		expect(result.conversationBudget).toBe(Math.floor(available * 0.8));
	});

	it("should use min of calculated and specified maxMemoryTokens", () => {
		const result = calculateContextBudget(10000, 5000, 200);
		const available = 10000 - 5000 - 1000;
		expect(result.memoryBudget).toBe(200);
		expect(result.conversationBudget).toBe(available - 200);
	});

	it("should reserve 1000 tokens for overhead", () => {
		const result = calculateContextBudget(6000, 5000);
		expect(result.memoryBudget).toBe(0);
		expect(result.conversationBudget).toBe(0);
	});
});
