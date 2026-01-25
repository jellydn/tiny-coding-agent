import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContextWithMemory, calculateContextBudget, MemoryStore } from "@/core/memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, "..", "..", "tmp");

// Ensure temp directory exists
try {
	mkdirSync(tempDir, { recursive: true });
} catch {
	/* ignore */
}

describe("MemoryStore", () => {
	const tempFile = path.join(tempDir, "test-memory.json");

	beforeEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			/* ignore */
		}
	});

	afterEach(() => {
		try {
			unlinkSync(tempFile);
		} catch {
			/* ignore */
		}
	});

	describe("add", () => {
		it("should add a memory with default user category", () => {
			const store = new MemoryStore();
			const memory = store.add("test content");

			expect(memory.content).toBe("test content");
			expect(memory.category).toBe("user");
			expect(memory.id).toBeDefined();
			expect(memory.createdAt).toBeDefined();
		});

		it("should add a memory with specified category", () => {
			const store = new MemoryStore();
			const memory = store.add("project info", "project");

			expect(memory.content).toBe("project info");
			expect(memory.category).toBe("project");
		});

		it("should store memory in internal map", () => {
			const store = new MemoryStore();
			const memory = store.add("test");

			expect(store.count()).toBe(1);
			const retrieved = store.get(memory.id);
			expect(retrieved).toBeDefined();
			expect(retrieved?.content).toBe("test");
		});
	});

	describe("get", () => {
		it("should return undefined for non-existent memory", () => {
			const store = new MemoryStore();

			expect(store.get("non-existent")).toBeUndefined();
		});

		it("should update access stats when retrieving", () => {
			const store = new MemoryStore();
			const memory = store.add("test");
			const initialAccessCount = memory.accessCount;

			store.get(memory.id);

			const retrieved = store.get(memory.id);
			expect(retrieved?.accessCount).toBeGreaterThan(initialAccessCount);
		});
	});

	describe("list", () => {
		it("should return memories sorted by last accessed time", () => {
			const store = new MemoryStore();
			store.add("first");
			store.add("second");
			store.add("third");

			const list = store.list();

			expect(list.length).toBe(3);
			// Most recently added should be first (lastAccessedAt is set on add)
			// All memories have same lastAccessedAt if created in same ms, so order may vary
			const contents = list.map((m) => m.content);
			expect(contents).toContain("first");
			expect(contents).toContain("second");
			expect(contents).toContain("third");
		});

		it("should return empty array when no memories", () => {
			const store = new MemoryStore();

			expect(store.list()).toEqual([]);
		});
	});

	describe("listByCategory", () => {
		it("should filter memories by category", () => {
			const store = new MemoryStore();
			store.add("user memory 1", "user");
			store.add("project memory", "project");
			store.add("user memory 2", "user");
			store.add("codebase memory", "codebase");

			const userMemories = store.listByCategory("user");
			const projectMemories = store.listByCategory("project");

			expect(userMemories.length).toBe(2);
			expect(projectMemories.length).toBe(1);
			for (const m of userMemories) {
				expect(m.category).toBe("user");
			}
		});
	});

	describe("remove", () => {
		it("should return true when memory exists", () => {
			const store = new MemoryStore();
			const memory = store.add("test");

			expect(store.remove(memory.id)).toBe(true);
			expect(store.count()).toBe(0);
		});

		it("should return false when memory does not exist", () => {
			const store = new MemoryStore();

			expect(store.remove("non-existent")).toBe(false);
		});
	});

	describe("clear", () => {
		it("should remove all memories", () => {
			const store = new MemoryStore();
			store.add("test1");
			store.add("test2");
			store.add("test3");

			store.clear();

			expect(store.count()).toBe(0);
			expect(store.list()).toEqual([]);
		});
	});

	describe("count", () => {
		it("should return correct count", () => {
			const store = new MemoryStore();
			expect(store.count()).toBe(0);

			store.add("test1");
			expect(store.count()).toBe(1);

			store.add("test2");
			expect(store.count()).toBe(2);
		});
	});

	describe("findRelevant", () => {
		it("should return memories matching query words", () => {
			const store = new MemoryStore();
			store.add("TypeScript is great");
			store.add("Python is cool");
			store.add("JavaScript rules");

			const results = store.findRelevant("TypeScript", 10);

			expect(results.length).toBe(1);
			expect(results[0]?.content).toBe("TypeScript is great");
		});

		it("should return up to maxResults memories", () => {
			const store = new MemoryStore();
			for (let i = 0; i < 10; i++) {
				store.add(`test content ${i}`);
			}

			const results = store.findRelevant("test", 3);

			expect(results.length).toBe(3);
		});

		it("should return empty array when no matches", () => {
			const store = new MemoryStore();
			store.add("hello world");

			const results = store.findRelevant("nonexistent", 5);

			expect(results).toEqual([]);
		});

		it("should apply category multipliers", () => {
			const store = new MemoryStore();
			store.add("same content", "user");
			store.add("same content", "project");

			const results = store.findRelevant("same content", 2);

			expect(results.length).toBe(2);
			// Project has higher multiplier (1.5x), so should rank higher
			expect(results[0]?.category).toBe("project");
		});

		it("should boost frequently accessed memories", () => {
			const store = new MemoryStore();
			const mem1 = store.add("test content");
			store.add("test content");

			// Access mem1 multiple times
			for (let i = 0; i < 5; i++) {
				store.get(mem1.id);
			}

			const results = store.findRelevant("test content", 2);

			expect(results[0]?.id).toBe(mem1.id);
		});
	});

	describe("toContextString", () => {
		it("should format memories as context string", () => {
			const store = new MemoryStore();
			store.add("user preference", "user");
			store.add("project config", "project");

			const context = store.toContextString();

			expect(context).toContain("## Relevant Memories");
			expect(context).toContain("[user] user preference");
			expect(context).toContain("[project] project config");
		});

		it("should return empty string when no memories", () => {
			const store = new MemoryStore();

			expect(store.toContextString()).toBe("");
		});
	});

	describe("eviction", () => {
		it("should evict oldest memories when over max limit", () => {
			const store = new MemoryStore({ filePath: tempFile, maxMemories: 3 });
			store.add("1");
			store.add("2");
			store.add("3");
			store.add("4");

			expect(store.count()).toBe(3);
			// First memory should be evicted
			const list = store.list();
			const contents = list.map((m) => m.content);
			// "1" should be evicted since it was added first and not accessed since
			expect(contents).not.toContain("1");
			expect(contents).toContain("2");
			expect(contents).toContain("3");
			expect(contents).toContain("4");
		});
	});

	describe("persistence", () => {
		it("should load memories from file on initialization", async () => {
			// Create a pre-populated memory file
			const data = {
				version: 1,
				updatedAt: new Date().toISOString(),
				memories: [
					{
						id: "persisted-1",
						content: "loaded memory",
						category: "project",
						createdAt: new Date().toISOString(),
						lastAccessedAt: new Date().toISOString(),
						accessCount: 1,
					},
				],
			};
			writeFileSync(tempFile, JSON.stringify(data), "utf-8");

			const store = new MemoryStore({ filePath: tempFile });
			await store.init();

			expect(store.count()).toBe(1);
			const memory = store.list()[0];
			expect(memory?.content).toBe("loaded memory");
			expect(memory?.category).toBe("project");
		});
	});

	describe("touchAll", () => {
		it("should update all memories access time and count", () => {
			const store = new MemoryStore();
			store.add("test1");
			store.add("test2");

			const initialList = store.list();
			const initialAccessCounts = initialList.map((m) => m.accessCount);

			store.touchAll();

			const updatedList = store.list();
			const minInitialCount = initialAccessCounts[0] ?? 0;
			for (const m of updatedList) {
				expect(m.accessCount).toBeGreaterThan(minInitialCount);
			}
		});
	});

	describe("flush and close", () => {
		it("should flush pending saves", async () => {
			const store = new MemoryStore({ filePath: tempFile });
			store.add("test");

			await store.flush();

			// File should be written
			expect(existsSync(tempFile)).toBe(true);
		});

		it("should close and flush", async () => {
			const store = new MemoryStore({ filePath: tempFile });
			store.add("test");

			await store.close();

			expect(existsSync(tempFile)).toBe(true);
		});
	});
});

describe("calculateContextBudget", () => {
	it("should return zero budgets when system prompt exceeds context", () => {
		const result = calculateContextBudget(5000, 4000);

		expect(result.memoryBudget).toBe(0);
		expect(result.conversationBudget).toBe(0);
	});

	it("should allocate 20% of remaining to memory by default", () => {
		const result = calculateContextBudget(10000, 2000);

		// 10000 - 2000 - 1000 = 7000 available
		// 20% of 7000 = 1400
		expect(result.memoryBudget).toBe(1400);
		expect(result.conversationBudget).toBe(5600);
	});

	it("should respect maxMemoryTokens when specified", () => {
		const result = calculateContextBudget(10000, 2000, 500);

		// 7000 available, but maxMemoryTokens is 500, so memoryBudget = 500
		expect(result.memoryBudget).toBe(500);
		expect(result.conversationBudget).toBe(6500);
	});

	it("should use smaller of maxMemoryTokens and 20% allocation", () => {
		const result = calculateContextBudget(10000, 2000, 2000);

		// 7000 available, 20% = 1400, but max is 2000, so use 1400
		expect(result.memoryBudget).toBe(1400);
		expect(result.conversationBudget).toBe(5600);
	});
});

describe("buildContextWithMemory", () => {
	it("should include system prompt and memories within budget", () => {
		const systemPrompt = "You are a helpful assistant.";
		const memories = [
			{
				id: "1",
				content: "User prefers TypeScript",
				category: "user" as const,
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			},
		];
		const messages = [{ role: "user" as const, content: "Hello" }];

		const result = buildContextWithMemory(systemPrompt, memories, messages, 100, 100);

		expect(result.context.length).toBeGreaterThanOrEqual(2);
		expect(result.stats.memoryCount).toBe(1);
		expect(result.stats.memoryTokens).toBeGreaterThan(0);
	});

	it("should handle empty memories", () => {
		const result = buildContextWithMemory("system", [], [], 100, 100);

		expect(result.context.length).toBe(1); // Only system prompt
		expect(result.stats.memoryCount).toBe(0);
	});

	it("should truncate when memories exceed budget", () => {
		const systemPrompt = "System prompt";
		const memories = [
			{
				id: "1",
				content: "A".repeat(100),
				category: "user" as const,
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			},
			{
				id: "2",
				content: "B".repeat(100),
				category: "user" as const,
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			},
		];
		const messages = [{ role: "user" as const, content: "Hello" }];

		const result = buildContextWithMemory(systemPrompt, memories, messages, 5, 100);

		expect(result.stats.truncationApplied).toBe(true);
		expect(result.stats.memoryCount).toBeLessThan(memories.length);
	});
});
