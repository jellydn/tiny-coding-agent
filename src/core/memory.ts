import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
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
  maxMemoryTokens?: number;
  autoLoad?: boolean;
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

const CATEGORY_MULTIPLIERS: Record<MemoryCategory, number> = {
  project: 1.5,
  codebase: 1.2,
  user: 1,
};

function getCategoryMultiplier(category: MemoryCategory): number {
  return CATEGORY_MULTIPLIERS[category] ?? 1;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export class MemoryStore {
  private _memories: Map<string, Memory> = new Map();
  private _filePath?: string;
  private _maxMemories: number;
  private _maxMemoryTokens?: number;
  private _saveTimeout?: NodeJS.Timeout;
  private _initPromise?: Promise<void>;

  constructor(options: MemoryStoreOptions = {}) {
    this._filePath = options.filePath;
    this._maxMemories = Math.max(1, options.maxMemories ?? 100);
    this._maxMemoryTokens = options.maxMemoryTokens;

    if (options.autoLoad !== false && this._filePath && existsSync(this._filePath)) {
      this._initPromise = this._load().catch((err) => {
        console.error(`Warning: Failed to load memories: ${err}`);
      });
    }
  }

  async init(): Promise<void> {
    await this._initPromise;
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

  /**
   * Mark all memories as accessed (updates lastAccessedAt and increments accessCount)
   */
  touchAll(): void {
    const now = new Date().toISOString();
    for (const memory of this._memories.values()) {
      memory.lastAccessedAt = now;
      memory.accessCount++;
    }
    this._scheduleSave();
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

      // Calculate base score from word matches
      let score = 0;
      for (const word of queryWords) {
        if (content.includes(word)) {
          score += 10;
        }
      }

      // Apply category multiplier
      score *= getCategoryMultiplier(category);

      // Add frequency bonus
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

  async flush(): Promise<void> {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = undefined;
    }
    await this._save();
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private _scheduleSave(): void {
    if (this._saveTimeout) return;
    this._saveTimeout = setTimeout(() => {
      this._saveTimeout = undefined;
      void this._save();
    }, SAVE_DEBOUNCE_MS);
  }

  private async _load(): Promise<void> {
    if (!this._filePath) return;

    try {
      await fs.access(this._filePath);
    } catch {
      return;
    }

    try {
      const content = await fs.readFile(this._filePath, "utf-8");
      const data = JSON.parse(content);
      const memories:
        | Array<{
            id: string;
            content: string;
            category: string;
            createdAt: string;
            lastAccessedAt?: string;
            accessCount?: number;
          }>
        | undefined = data.memories;

      if (memories && Array.isArray(memories)) {
        for (const m of memories) {
          this._memories.set(m.id, {
            id: m.id,
            content: m.content,
            category: m.category as MemoryCategory,
            createdAt: m.createdAt,
            lastAccessedAt: m.lastAccessedAt ?? m.createdAt,
            accessCount: m.accessCount ?? 0,
          });
        }
      }
    } catch (err) {
      console.error(`Warning: Failed to load memories from ${this._filePath}: ${err}`);
    }
  }

  private async _save(): Promise<void> {
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
          lastAccessedAt: m.lastAccessedAt,
          accessCount: m.accessCount,
        })),
      };
      await fs.writeFile(this._filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error(`Warning: Failed to save memories to ${this._filePath}: ${err}`);
    }
  }

  private _evictIfNeeded(): void {
    // Token-based eviction first (if configured)
    if (this._maxMemoryTokens !== undefined) {
      while (this._countMemoryTokens() > this._maxMemoryTokens && this._memories.size > 1) {
        this._evictOldest();
      }
    }

    // Count-based eviction as fallback
    while (this._memories.size > this._maxMemories) {
      this._evictOldest();
    }
  }

  /**
   * Calculate total tokens used by all memories
   */
  private _countMemoryTokens(): number {
    return Array.from(this._memories.values()).reduce(
      (total, m) => total + countTokensSync(m.content) + countTokensSync(m.category),
      0,
    );
  }

  /**
   * Evict the least recently accessed memory
   */
  private _evictOldest(): void {
    const oldest = Array.from(this._memories.values()).sort(
      (a, b) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime(),
    )[0];
    if (oldest) this._memories.delete(oldest.id);
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
