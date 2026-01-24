import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { countTokensSync } from "./tokens.js";

const SAVE_DEBOUNCE_MS = 100;

export type MemoryCategory = "user" | "project" | "codebase";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

export interface MemoryStoreOptions {
  filePath?: string;
  maxMemories?: number;
}

export interface ContextStats {
  systemPromptTokens: number;
  memoryTokens: number;
  conversationTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  truncationApplied: boolean;
  memoryCount: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class MemoryStore {
  private _memories: Map<string, Memory> = new Map();
  private _filePath?: string;
  private _maxMemories: number;
  private _saveTimeout?: NodeJS.Timeout;
  private _dirty = false;

  constructor(options: MemoryStoreOptions = {}) {
    this._filePath = options.filePath;
    this._maxMemories = options.maxMemories ?? 100;

    if (this._filePath && existsSync(this._filePath)) {
      this._load();
    }
  }

  add(content: string, category: MemoryCategory = "user"): Memory {
    const now = new Date().toISOString();
    const memory: Memory = {
      id: generateId(),
      content,
      category,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };

    this._memories.set(memory.id, memory);
    this._evictIfNeeded();
    this._scheduleSave();

    return memory;
  }

  get(id: string): Memory | undefined {
    const memory = this._memories.get(id);
    if (memory) {
      memory.lastAccessedAt = new Date().toISOString();
      memory.accessCount++;
      this._scheduleSave();
    }
    return memory;
  }

  list(): Memory[] {
    return Array.from(this._memories.values()).sort((a, b) => {
      return new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime();
    });
  }

  listByCategory(category: MemoryCategory): Memory[] {
    return this.list().filter((m) => m.category === category);
  }

  remove(id: string): boolean {
    const removed = this._memories.delete(id);
    if (removed) {
      this._scheduleSave();
    }
    return removed;
  }

  clear(): void {
    this._memories.clear();
    this._scheduleSave();
  }

  count(): number {
    return this._memories.size;
  }

  findRelevant(query: string, maxResults: number = 5): Memory[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const scored: Array<{ memory: Memory; score: number }> = [];

    for (const memory of this._memories.values()) {
      const content = memory.content.toLowerCase();
      const category = memory.category;

      let score = 0;

      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 10;
        }
      }

      if (category === "project") {
        score *= 1.5;
      } else if (category === "codebase") {
        score *= 1.2;
      }

      score += Math.log(memory.accessCount + 1) * 2;

      if (score > 0) {
        scored.push({ memory, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, maxResults).map((s) => {
      s.memory.lastAccessedAt = new Date().toISOString();
      s.memory.accessCount++;
      return s.memory;
    });

    if (results.length > 0) {
      this._scheduleSave();
    }

    return results;
  }

  toContextString(): string {
    const memories = this.list();
    if (memories.length === 0) {
      return "";
    }

    const lines: string[] = ["## Relevant Memories"];
    for (const memory of memories) {
      lines.push(`- [${memory.category}] ${memory.content}`);
    }
    return lines.join("\n");
  }

  countTokens(): number {
    return Array.from(this._memories.values()).reduce(
      (total, m) => total + countTokensSync(m.content) + countTokensSync(m.category),
      0,
    );
  }

  private _scheduleSave(): void {
    this._dirty = true;
    if (this._saveTimeout) return;

    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = undefined;
      if (this._dirty) {
        this._dirty = false;
        this._save();
      }
    }, SAVE_DEBOUNCE_MS);
  }

  private _load(): void {
    if (!this._filePath || !existsSync(this._filePath)) {
      return;
    }

    try {
      const content = readFileSync(this._filePath, "utf-8");
      const data = JSON.parse(content);
      const memories: Array<Omit<Memory, "lastAccessedAt" | "accessCount">> | undefined =
        data.memories;

      if (memories && Array.isArray(memories)) {
        for (const m of memories) {
          this._memories.set(m.id, {
            ...m,
            lastAccessedAt: m.createdAt,
            accessCount: 0,
          });
        }
      }
    } catch (err) {
      console.error(`Warning: Failed to load memories from ${this._filePath}: ${err}`);
    }
  }

  private _save(): void {
    if (!this._filePath) {
      return;
    }

    try {
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        memories: Array.from(this._memories.values()).map((m) => ({
          id: m.id,
          content: m.content,
          category: m.category,
          createdAt: m.createdAt,
        })),
      };
      writeFileSync(this._filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`Warning: Failed to save memories to ${this._filePath}: ${err}`);
    }
  }

  private _evictIfNeeded(): void {
    while (this._memories.size > this._maxMemories) {
      let oldestId: string | undefined;
      let oldestTime = Infinity;

      for (const [id, memory] of this._memories) {
        const accessTime = new Date(memory.lastAccessedAt).getTime();
        if (accessTime < oldestTime) {
          oldestTime = accessTime;
          oldestId = id;
        }
      }
      if (oldestId) this._memories.delete(oldestId);
    }
  }
}

export function calculateContextBudget(
  maxContextTokens: number,
  systemPromptTokens: number,
  maxMemoryTokens?: number,
): { memoryBudget: number; conversationBudget: number } {
  const availableForContent = maxContextTokens - systemPromptTokens - 1000;

  if (availableForContent <= 0) {
    return { memoryBudget: 0, conversationBudget: 0 };
  }

  if (maxMemoryTokens !== undefined) {
    const memoryBudget = Math.min(maxMemoryTokens, Math.floor(availableForContent * 0.2));
    return {
      memoryBudget,
      conversationBudget: availableForContent - memoryBudget,
    };
  }

  const memoryBudget = Math.floor(availableForContent * 0.2);
  return {
    memoryBudget,
    conversationBudget: availableForContent - memoryBudget,
  };
}

export function buildContextWithMemory(
  systemPrompt: string,
  memories: Memory[],
  conversationMessages: Array<{ role: string; content: string }>,
  memoryBudget: number,
  conversationBudget: number,
): { context: Array<{ role: string; content: string }>; stats: ContextStats } {
  const systemTokens = countTokensSync(systemPrompt);

  let memoryTokens = 0;
  const includedMemories: string[] = [];

  for (const memory of memories) {
    const tokens = countTokensSync(memory.content);
    if (memoryTokens + tokens <= memoryBudget) {
      memoryTokens += tokens;
      includedMemories.push(`[${memory.category}] ${memory.content}`);
    }
  }

  const memoryContext =
    includedMemories.length > 0 ? `## Relevant Memories\n${includedMemories.join("\n")}` : "";

  const context: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (memoryContext) {
    context.push({ role: "system", content: memoryContext });
  }

  let conversationTokens = 0;
  const includedMessages: Array<{ role: string; content: string }> = [];

  for (let i = 0; i < conversationMessages.length; i++) {
    const msg = conversationMessages[i] as { role: string; content: string };
    const tokens = countTokensSync(msg.content);
    if (conversationTokens + tokens <= conversationBudget) {
      conversationTokens += tokens;
      includedMessages.push(msg);
    }
  }

  context.push(...includedMessages);

  const totalTokens = systemTokens + memoryTokens + conversationTokens;
  const truncationApplied =
    includedMessages.length < conversationMessages.length ||
    includedMemories.length < memories.length;

  return {
    context,
    stats: {
      systemPromptTokens: systemTokens,
      memoryTokens,
      conversationTokens,
      totalTokens,
      maxContextTokens: systemTokens + memoryBudget + conversationBudget,
      truncationApplied,
      memoryCount: includedMemories.length,
    },
  };
}
