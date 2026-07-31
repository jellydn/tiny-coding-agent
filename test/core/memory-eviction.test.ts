import { describe, expect, it } from "bun:test";
import {
	CATEGORY_MULTIPLIERS,
	countMemoryTokens,
	evictOldest,
	generateMemoryId,
	getCategoryMultiplier,
	type Memory,
	shouldEvict,
} from "@/core/memory-eviction.js";

describe("memory-eviction", () => {
	describe("CATEGORY_MULTIPLIERS", () => {
		it("should have correct multipliers", () => {
			expect(CATEGORY_MULTIPLIERS.project).toBe(1.5);
			expect(CATEGORY_MULTIPLIERS.codebase).toBe(1.2);
			expect(CATEGORY_MULTIPLIERS.user).toBe(1);
		});
	});

	describe("getCategoryMultiplier", () => {
		it("should return 1.5 for project category", () => {
			expect(getCategoryMultiplier("project")).toBe(1.5);
		});

		it("should return 1.2 for codebase category", () => {
			expect(getCategoryMultiplier("codebase")).toBe(1.2);
		});

		it("should return 1 for user category", () => {
			expect(getCategoryMultiplier("user")).toBe(1);
		});
	});

	describe("generateMemoryId", () => {
		it("should generate unique IDs", () => {
			const id1 = generateMemoryId();
			const id2 = generateMemoryId();
			expect(id1).not.toBe(id2);
		});

		it("should contain timestamp and random string", () => {
			const id = generateMemoryId();
			expect(id).toMatch(/^\d+-[a-z0-9]+$/);
		});
	});

	describe("countMemoryTokens", () => {
		it("should return 0 for empty memories", () => {
			const memories = new Map<string, Memory>();
			expect(countMemoryTokens(memories)).toBe(0);
		});

		it("should count tokens for single memory", () => {
			const memories = new Map<string, Memory>();
			memories.set("1", {
				id: "1",
				content: "test content",
				category: "user",
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			});
			expect(countMemoryTokens(memories)).toBeGreaterThan(0);
		});

		it("should sum tokens across multiple memories", () => {
			const memories = new Map<string, Memory>();
			memories.set("1", {
				id: "1",
				content: "first",
				category: "user",
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			});
			memories.set("2", {
				id: "2",
				content: "second",
				category: "project",
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			});
			expect(countMemoryTokens(memories)).toBeGreaterThan(0);
		});
	});

	describe("shouldEvict", () => {
		it("should return false when under limits", () => {
			expect(shouldEvict(5, 10, 100, 200)).toBe(false);
		});

		it("should return true when count exceeds limit", () => {
			expect(shouldEvict(11, 10, 100, 200)).toBe(true);
		});

		it("should return true when tokens exceed limit", () => {
			expect(shouldEvict(5, 10, 201, 200)).toBe(true);
		});

		it("should return false when maxMemoryTokens is undefined", () => {
			expect(shouldEvict(5, 10, 1000, undefined)).toBe(false);
		});
	});

	describe("evictOldest", () => {
		it("should remove the last item from sortedIds", () => {
			const memories = new Map<string, Memory>();
			memories.set("1", {
				id: "1",
				content: "oldest",
				category: "user",
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			});
			memories.set("2", {
				id: "2",
				content: "newest",
				category: "user",
				createdAt: "",
				lastAccessedAt: "",
				accessCount: 0,
			});
			const sortedIds = ["2", "1"]; // Sorted by lastAccessedAt descending

			const evictedId = evictOldest(memories, sortedIds);

			expect(evictedId).toBe("1");
			expect(memories.has("1")).toBe(false);
			expect(sortedIds).toEqual(["2"]);
		});

		it("should return undefined for empty sortedIds", () => {
			const memories = new Map<string, Memory>();
			const sortedIds: string[] = [];

			const evictedId = evictOldest(memories, sortedIds);

			expect(evictedId).toBeUndefined();
			expect(sortedIds).toEqual([]);
		});
	});
});
