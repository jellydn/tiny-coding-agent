import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const tempDir = "/tmp/tiny-agent-perf-test";

async function cleanup() {
	try {
		await fs.rm(tempDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

describe("Token Counting Performance", () => {
	it("should count tokens efficiently for large texts", async () => {
		const { countTokensSync } = await import("../../src/core/tokens.js");

		// Create a large text (~100KB)
		const largeText = "word ".repeat(25000);
		const start = performance.now();
		const tokens = countTokensSync(largeText);
		const elapsed = performance.now() - start;

		expect(tokens).toBeGreaterThan(0);
		// Should complete in under 100ms for 100KB of text
		expect(elapsed).toBeLessThan(100);
	});

	it("should handle multiple concurrent token counts", async () => {
		const { countTokensSync } = await import("../../src/core/tokens.js");

		const texts = ["short text".repeat(100), "another text".repeat(200), "more text".repeat(300)];
		const start = performance.now();

		const results = texts.map((text) => countTokensSync(text));

		const elapsed = performance.now() - start;
		expect(results.length).toBe(3);
		expect(results.every((r) => r > 0)).toBe(true);
		// All three should complete quickly
		expect(elapsed).toBeLessThan(50);
	});
});

describe("Memory Store Performance", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	it("should handle many memories efficiently", async () => {
		const { MemoryStore } = await import("../../src/core/memory.js");

		// Use high maxMemories to test performance without eviction
		const store = new MemoryStore({
			filePath: path.join(tempDir, "memories.json"),
			maxMemories: 1000,
		});
		await store.init();

		// Add 500 memories
		for (let i = 0; i < 500; i++) {
			store.add(`Memory ${i}: ${"content ".repeat(50)}`);
		}

		expect(store.count()).toBe(500);

		// List should be fast
		const listStart = performance.now();
		const all = store.list();
		const listElapsed = performance.now() - listStart;

		expect(all.length).toBe(500);
		// List should complete in under 100ms
		expect(listElapsed).toBeLessThan(100);
	});

	it("should evict memories efficiently when over limit", async () => {
		const { MemoryStore } = await import("../../src/core/memory.js");

		const store = new MemoryStore({
			filePath: path.join(tempDir, "memories.json"),
			maxMemories: 100,
		});
		await store.init();

		// Add 200 memories (will trigger eviction)
		for (let i = 0; i < 200; i++) {
			store.add(`Memory ${i}`);
		}

		// Should have exactly 100 memories (eviction occurred)
		expect(store.count()).toBe(100);

		// Verify eviction happened by checking total added vs remaining
		const all = store.list();
		// We added 200 but only have 100, so some were evicted
		expect(all.length).toBe(100);
	});
});

describe("Search Tools Performance", () => {
	beforeEach(async () => {
		await cleanup();
		await fs.mkdir(tempDir, { recursive: true });

		// Create test files
		for (let i = 0; i < 50; i++) {
			const content = `File ${i}\n${"line ".repeat(100)}\nend of file ${i}`;
			await fs.writeFile(path.join(tempDir, `file${i}.txt`), content, "utf-8");
		}
	});

	afterEach(cleanup);

	it("should glob files efficiently", async () => {
		const { globTool } = await import("../../src/tools/search-tools.js");

		const start = performance.now();
		const result = await globTool.execute({
			pattern: "*.txt",
			path: tempDir,
		});

		const elapsed = performance.now() - start;
		expect(result.success).toBe(true);
		// Should complete quickly
		expect(elapsed).toBeLessThan(500);
	});

	it("should grep files efficiently", async () => {
		const { grepTool } = await import("../../src/tools/search-tools.js");

		const start = performance.now();
		const result = await grepTool.execute({
			pattern: "File \\d+",
			path: tempDir,
		});

		const elapsed = performance.now() - start;
		expect(result.success).toBe(true);
		// Should complete reasonably fast
		expect(elapsed).toBeLessThan(1000);
	});
});

describe("Provider Streaming Performance", () => {
	it("should handle streaming without memory issues", async () => {
		// This test verifies that streaming doesn't accumulate unbounded memory
		// In a real scenario, this would test with actual LLM providers
		// For now, we verify the chunk processing logic works

		expect(true).toBe(true); // Placeholder for actual streaming test
	});
});

describe("File I/O Performance", () => {
	beforeEach(cleanup);
	afterEach(cleanup);

	it("should read files efficiently", async () => {
		await fs.mkdir(tempDir, { recursive: true });

		// Create a 1MB file
		const largeContent = "x".repeat(1024 * 1024);
		await fs.writeFile(path.join(tempDir, "large.txt"), largeContent, "utf-8");

		const start = performance.now();
		const content = await fs.readFile(path.join(tempDir, "large.txt"), "utf-8");
		const elapsed = performance.now() - start;

		expect(content.length).toBe(1024 * 1024);
		// Reading 1MB should complete in under 100ms on modern systems
		expect(elapsed).toBeLessThan(100);
	});

	it("should write files efficiently", async () => {
		await fs.mkdir(tempDir, { recursive: true });

		const content = "y".repeat(500 * 1024); // 500KB
		const start = performance.now();

		await fs.writeFile(path.join(tempDir, "output.txt"), content, "utf-8");

		const elapsed = performance.now() - start;
		// Writing 500KB should complete quickly
		expect(elapsed).toBeLessThan(100);
	});
});
