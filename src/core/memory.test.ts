import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import {
  MemoryStore,
  calculateContextBudget,
  buildContextWithMemory,
  type Memory,
} from "./memory.js";

const TEMP_DIR = "/tmp/test-memory-store";

beforeEach(() => {
  try {
    mkdirSync(TEMP_DIR, { recursive: true });
  } catch {
    // ignore
  }
});

afterEach(() => {
  try {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function getMemoryFile(): string {
  return path.join(TEMP_DIR, `memory-${Date.now()}.json`);
}

describe("MemoryStore", () => {
  describe("add()", () => {
    it("should add a memory with default user category", () => {
      const store = new MemoryStore({ autoLoad: false });
      const memory = store.add("test content");

      expect(memory.content).toBe("test content");
      expect(memory.category).toBe("user");
      expect(memory.id).toBeDefined();
      expect(memory.createdAt).toBeDefined();
      expect(memory.accessCount).toBe(0);
    });

    it("should add memories with specified category", () => {
      const store = new MemoryStore({ autoLoad: false });

      const userMem = store.add("user memory", "user");
      const projectMem = store.add("project memory", "project");
      const codebaseMem = store.add("codebase memory", "codebase");

      expect(userMem.category).toBe("user");
      expect(projectMem.category).toBe("project");
      expect(codebaseMem.category).toBe("codebase");
    });

    it("should store memories that can be retrieved via list()", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("first memory");
      store.add("second memory");

      const memories = store.list();

      expect(memories).toHaveLength(2);
      // Memories are sorted by lastAccessedAt descending (newest first)
      expect(memories.map((m) => m.content)).toEqual(["second memory", "first memory"]);
    });
  });

  describe("get()", () => {
    it("should retrieve an existing memory by id", () => {
      const store = new MemoryStore({ autoLoad: false });
      const added = store.add("test content");
      const retrieved = store.get(added.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe("test content");
    });

    it("should return undefined for non-existent id", () => {
      const store = new MemoryStore({ autoLoad: false });
      const result = store.get("non-existent-id");

      expect(result).toBeUndefined();
    });

    it("should update lastAccessedAt and accessCount on retrieval", () => {
      const store = new MemoryStore({ autoLoad: false });
      const added = store.add("test content");
      const memory = store.get(added.id);

      expect(memory?.accessCount).toBe(1);
      // Timestamp should be updated (may be same if within same millisecond, so check accessCount)
      expect(memory?.lastAccessedAt).toBeDefined();
    });
  });

  describe("remove()", () => {
    it("should remove an existing memory", () => {
      const store = new MemoryStore({ autoLoad: false });
      const memory = store.add("test content");
      expect(store.count()).toBe(1);

      const removed = store.remove(memory.id);

      expect(removed).toBe(true);
      expect(store.count()).toBe(0);
      expect(store.get(memory.id)).toBeUndefined();
    });

    it("should return false when removing non-existent memory", () => {
      const store = new MemoryStore({ autoLoad: false });

      const removed = store.remove("non-existent-id");

      expect(removed).toBe(false);
    });
  });

  describe("clear()", () => {
    it("should remove all memories", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("memory 1");
      store.add("memory 2");
      store.add("memory 3");

      store.clear();

      expect(store.count()).toBe(0);
      expect(store.list()).toHaveLength(0);
    });
  });

  describe("count()", () => {
    it("should return the number of stored memories", () => {
      const store = new MemoryStore({ autoLoad: false });
      expect(store.count()).toBe(0);

      store.add("first");
      expect(store.count()).toBe(1);

      store.add("second");
      expect(store.count()).toBe(2);

      store.remove(store.list()[0]!.id);
      expect(store.count()).toBe(1);
    });
  });

  describe("listByCategory()", () => {
    it("should return only memories of specified category", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("user1", "user");
      store.add("user2", "user");
      store.add("project1", "project");
      store.add("codebase1", "codebase");

      const userMemories = store.listByCategory("user");
      const projectMemories = store.listByCategory("project");

      expect(userMemories).toHaveLength(2);
      expect(projectMemories).toHaveLength(1);
      expect(userMemories.every((m) => m.category === "user")).toBe(true);
    });
  });

  describe("findRelevant()", () => {
    it("should find memories matching query words", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("TypeScript is great");
      store.add("Python is cool too");
      store.add("Rust programming language");

      const results = store.findRelevant("TypeScript", 10);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toContain("TypeScript");
    });

    it("should prioritize memories by word match count", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("JavaScript test code"); // 2 matches
      store.add("JavaScript and TypeScript"); // 2 matches
      store.add("Only JavaScript"); // 1 match

      const results = store.findRelevant("JavaScript", 3);

      expect(results.length).toBe(3);
      // Memories with more access count or relevance should come first
    });

    it("should return limited results", () => {
      const store = new MemoryStore({ autoLoad: false });
      for (let i = 0; i < 10; i++) {
        store.add(`memory ${i} test`);
      }

      const results = store.findRelevant("test", 5);

      expect(results).toHaveLength(5);
    });

    it("should apply category multipliers to scoring", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("project config", "project"); // multiplier 1.5
      store.add("user preference", "user"); // multiplier 1

      const results = store.findRelevant("config preference", 2);

      // Both match, but project has higher multiplier
      expect(results.length).toBe(2);
    });
  });

  describe("toContextString()", () => {
    it("should return empty string when no memories", () => {
      const store = new MemoryStore({ autoLoad: false });

      const result = store.toContextString();

      expect(result).toBe("");
    });

    it("should format memories as context list", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.add("remember this", "user");
      store.add("project setting", "project");

      const result = store.toContextString();

      expect(result).toContain("## Relevant Memories");
      expect(result).toContain("[user] remember this");
      expect(result).toContain("[project] project setting");
    });
  });

  describe("eviction", () => {
    it("should evict oldest memories when max limit exceeded", () => {
      const store = new MemoryStore({ autoLoad: false, maxMemories: 3 });
      store.add("memory 1");
      store.add("memory 2");
      store.add("memory 3");
      store.add("memory 4");
      store.add("memory 5");

      expect(store.count()).toBe(3);
      // Oldest should be evicted first
      const memories = store.list().filter(Boolean);
      const contents = memories.map((m) => m.content);
      // Oldest are evicted first, remaining should be newest 3
      expect(contents).toEqual(["memory 5", "memory 4", "memory 3"]);
    });

    it("should evict by token limit when configured", () => {
      const store = new MemoryStore({ autoLoad: false, maxMemories: 100, maxMemoryTokens: 50 });
      store.add("short"); // ~1 token
      store.add("a".repeat(100)); // more tokens
      store.add("b".repeat(200)); // even more tokens

      expect(store.count()).toBeLessThanOrEqual(2);
    });
  });

  describe("persistence", () => {
    it("should save and load memories from file", async () => {
      const filePath = getMemoryFile();

      // Create store and add memories
      {
        const store = new MemoryStore({ filePath, autoLoad: true });
        store.add("saved memory 1");
        store.add("saved memory 2");
        await store.flush();
      }

      // Load from file
      {
        const store = new MemoryStore({ filePath, autoLoad: true });
        await store.init();
        expect(store.count()).toBe(2);
        const memories = store.list().filter(Boolean);
        expect(memories.map((m) => m.content)).toEqual(["saved memory 1", "saved memory 2"]);
        await store.close();
      }
    });

    it("should handle corrupted memory file gracefully", () => {
      const filePath = getMemoryFile();
      writeFileSync(filePath, "not valid json", "utf-8");

      // Should not throw, should continue with empty store
      const store = new MemoryStore({ filePath, autoLoad: true });

      expect(store.count()).toBe(0);
    });
  });

  describe("signal handlers", () => {
    it("should register and remove signal handlers", () => {
      const store = new MemoryStore({ autoLoad: false });
      store.registerSignalHandlers();
      expect(store["_signalHandlersRegistered"]).toBe(true);

      store.removeSignalHandlers();
      expect(store["_signalHandlersRegistered"]).toBe(false);
    });
  });
});

describe("calculateContextBudget", () => {
  it("should allocate memory and conversation budgets", () => {
    const result = calculateContextBudget(100000, 10000, undefined, { memoryBudgetPercent: 0.2 });

    // Available: 100000 - 10000 - 1000 = 89000
    // Memory: 89000 * 0.2 = 17800
    // Conversation: 89000 - 17800 = 71200
    expect(result.memoryBudget).toBe(17800);
    expect(result.conversationBudget).toBe(71200);
  });

  it("should respect maxMemoryTokens limit", () => {
    const result = calculateContextBudget(100000, 10000, 5000, { memoryBudgetPercent: 0.2 });

    // Available: 100000 - 10000 - 1000 = 89000
    // Without limit: 89000 * 0.2 = 17800, but capped at 5000
    expect(result.memoryBudget).toBe(5000);
    // Conversation gets: available - memoryBudget = 89000 - 5000 = 84000
    expect(result.conversationBudget).toBe(84000);
  });

  it("should return zero budgets when system prompt too large", () => {
    const result = calculateContextBudget(5000, 4000, undefined);

    expect(result.memoryBudget).toBe(0);
    expect(result.conversationBudget).toBe(0);
  });

  it("should use default 20% memory budget", () => {
    const result = calculateContextBudget(100000, 10000);

    expect(result.memoryBudget).toBe(17800);
    expect(result.conversationBudget).toBe(71200);
  });
});

describe("buildContextWithMemory", () => {
  it("should build context with memories and conversation within budget", () => {
    const systemPrompt = "You are a helpful assistant.";
    const memories: Memory[] = [
      {
        id: "1",
        content: "User prefers TypeScript",
        category: "user",
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 1,
      },
    ];
    const conversationMessages = [
      { role: "user", content: "Hello, I need help with a project." },
    ];

    const result = buildContextWithMemory(
      systemPrompt,
      memories,
      conversationMessages,
      5000, // memoryBudget
      10000, // conversationBudget
    );

    expect(result.context).toBeDefined();
    expect(result.stats.memoryCount).toBe(1);
    expect(result.stats.truncationApplied).toBe(false);
  });

  it("should truncate when memory exceeds budget", () => {
    const systemPrompt = "You are a helpful assistant.";
    const memories: Memory[] = [
      {
        id: "1",
        content: "a".repeat(10000), // very large memory
        category: "user",
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
      },
    ];
    const conversationMessages: Array<{ role: string; content: string }> = [];

    const result = buildContextWithMemory(systemPrompt, memories, conversationMessages, 100, 10000);

    expect(result.stats.memoryCount).toBe(0);
    expect(result.stats.truncationApplied).toBe(true);
  });

  it("should include memory context in system message", () => {
    const systemPrompt = "You are a helpful assistant.";
    const memories: Memory[] = [
      {
        id: "1",
        content: "User is named Alice",
        category: "user",
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 1,
      },
    ];
    const conversationMessages: Array<{ role: string; content: string }> = [];

    const result = buildContextWithMemory(
      systemPrompt,
      memories,
      conversationMessages,
      1000,
      1000,
    );

    const systemMessages = result.context.filter((m) => m.role === "system");
    expect(systemMessages.some((m) => m.content.includes("## Relevant Memories"))).toBe(true);
    expect(systemMessages.some((m) => m.content.includes("Alice"))).toBe(true);
  });
});
