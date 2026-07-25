import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { countTokensSync } from "./tokens.js";

const SAVE_DEBOUNCE_MS = 100;

const signalHandlerManager = {
	registeredStores: new Set<MemoryStore>(),
	globalHandlerRegistered: false,

	register(store: MemoryStore): void {
		this.registeredStores.add(store);
		if (!this.globalHandlerRegistered && typeof process !== "undefined") {
			this.globalHandlerRegistered = true;
			const handler = async () => {
				await Promise.all(Array.from(this.registeredStores).map((s) => s.flush().catch(() => {})));
				process.exit(1);
			};
			process.on("SIGTERM", handler);
			process.on("SIGINT", handler);
		}
	},

	unregister(store: MemoryStore): void {
		this.registeredStores.delete(store);
	},
};

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

export interface ContextBudgetOptions {
	memoryBudgetPercent?: number;
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
	private _sortedIds: string[] = []; // Sorted by lastAccessedAt descending
	private _filePath?: string;
	private _maxMemories: number;
	private _maxMemoryTokens?: number;
	private _saveTimeout?: NodeJS.Timeout;
	private _initPromise?: Promise<void>;

	get signalHandlersRegistered(): boolean {
		return signalHandlerManager.registeredStores.has(this);
	}

	constructor(options: MemoryStoreOptions = {}) {
		this._filePath = options.filePath;
		this._maxMemories = Math.max(1, options.maxMemories ?? 100);
		this._maxMemoryTokens = options.maxMemoryTokens;

		if (options.autoLoad !== false && this._filePath && existsSync(this._filePath)) {
			this._initPromise = this._load().catch((err) => {
				console.error(`[MemoryStore] Failed to load memories: ${err}`);
				console.error("[MemoryStore] Continuing with empty memory store");
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
		const newTime = new Date(memory.lastAccessedAt).getTime();
		let insertIndex = this._sortedIds.length;
		for (let i = 0; i < this._sortedIds.length; i++) {
			const existingId = this._sortedIds[i];
			if (!existingId) continue;
			const existingTime = new Date(this._memories.get(existingId)?.lastAccessedAt ?? "").getTime();
			if (existingTime <= newTime) {
				insertIndex = i;
				break;
			}
		}
		this._sortedIds.splice(insertIndex, 0, memory.id);
		this._evictIfNeeded();
		this._scheduleSave();

		return memory;
	}

	get(id: string): Memory | undefined {
		const memory = this._memories.get(id);
		if (!memory) return undefined;

		memory.lastAccessedAt = new Date().toISOString();
		memory.accessCount++;
		this._updateSortedPosition(id);
		this._scheduleSave();

		return memory;
	}

	private _updateSortedPosition(id: string): void {
		const memory = this._memories.get(id);
		if (!memory) return;

		const newTime = new Date(memory.lastAccessedAt).getTime();
		const currentIndex = this._sortedIds.indexOf(id);
		if (currentIndex <= 0) return;

		const prevId = this._sortedIds[currentIndex - 1];
		if (!prevId) return;

		const prevTime = new Date(this._memories.get(prevId)?.lastAccessedAt ?? "").getTime();
		if (newTime <= prevTime) return;

		this._sortedIds.splice(currentIndex, 1);
		let insertIndex = currentIndex - 1;
		while (insertIndex > 0) {
			const checkId = this._sortedIds[insertIndex - 1];
			if (!checkId) break;
			const checkTime = new Date(this._memories.get(checkId)?.lastAccessedAt ?? "").getTime();
			if (checkTime < newTime) break;
			insertIndex--;
		}
		this._sortedIds.splice(insertIndex, 0, id);
	}

	list(): Memory[] {
		const result: Memory[] = [];
		const missingIds: string[] = [];

		for (const id of this._sortedIds) {
			const memory = this._memories.get(id);
			if (memory) {
				result.push(memory);
			} else {
				missingIds.push(id);
			}
		}

		if (missingIds.length > 0) {
			console.warn(`[MemoryStore] Found ${missingIds.length} corrupted memory entry(s) in sorted index. Cleaning up.`);
			this._sortedIds = this._sortedIds.filter((id) => this._memories.has(id));
		}

		return result;
	}

	touchAll(): void {
		const now = new Date().toISOString();
		for (const memory of this._memories.values()) {
			memory.lastAccessedAt = now;
			memory.accessCount++;
		}
		this._sortedIds = Array.from(this._memories.keys());
		this._scheduleSave();
	}

	listByCategory(category: MemoryCategory): Memory[] {
		return this.list().filter((m) => m.category === category);
	}

	remove(id: string): boolean {
		const removed = this._memories.delete(id);
		if (removed) {
			const index = this._sortedIds.indexOf(id);
			if (index >= 0) {
				this._sortedIds.splice(index, 1);
			}
			this._scheduleSave();
		}
		return removed;
	}

	clear(): void {
		this._memories.clear();
		this._sortedIds = [];
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
			0
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
		this.removeSignalHandlers();
		await this.flush();
	}

	registerSignalHandlers(): void {
		if (typeof process === "undefined") return;
		signalHandlerManager.register(this);
	}

	removeSignalHandlers(): void {
		signalHandlerManager.unregister(this);
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
					const memory: Memory = {
						id: m.id,
						content: m.content,
						category: m.category as MemoryCategory,
						createdAt: m.createdAt,
						lastAccessedAt: m.lastAccessedAt ?? m.createdAt,
						accessCount: m.accessCount ?? 0,
					};
					this._memories.set(m.id, memory);
					this._sortedIds.push(m.id);
				}
				// Sort once after loading all memories
				this._sortedIds.sort((a, b) => {
					const timeA = new Date(this._memories.get(a)?.lastAccessedAt ?? "").getTime();
					const timeB = new Date(this._memories.get(b)?.lastAccessedAt ?? "").getTime();
					return timeB - timeA; // Descending
				});
			}
		} catch (err) {
			console.error(`[MemoryStore] Failed to load memories from ${this._filePath}: ${err}`);
			console.warn("[MemoryStore] Continuing with empty memory store. Your memory file may be corrupted.");
		}
	}

	private async _save(): Promise<void> {
		if (!this._filePath) {
			return;
		}

		try {
			const memoriesData = Array.from(this._memories.values()).map((m) => ({
				id: m.id,
				content: m.content,
				category: m.category,
				createdAt: m.createdAt,
				lastAccessedAt: m.lastAccessedAt,
				accessCount: m.accessCount,
			}));

			const data = {
				version: 1,
				updatedAt: new Date().toISOString(),
				memories: memoriesData,
			};
			await fs.writeFile(this._filePath, JSON.stringify(data, null, 2), "utf-8");
		} catch (err) {
			console.error(`[MemoryStore] Failed to save memories to ${this._filePath}: ${err}`);
		}
	}

	private _evictIfNeeded(): void {
		while (this._memories.size > 1) {
			const tokenCount = this._countMemoryTokens();
			const countLimitExceeded = this._memories.size > this._maxMemories;
			const tokenLimitExceeded = this._maxMemoryTokens !== undefined && tokenCount > this._maxMemoryTokens;

			if (!countLimitExceeded && !tokenLimitExceeded) {
				break;
			}

			this._evictOldest();
		}
	}

	private _countMemoryTokens(): number {
		return Array.from(this._memories.values()).reduce(
			(total, m) => total + countTokensSync(m.content) + countTokensSync(m.category),
			0
		);
	}

	private _evictOldest(): void {
		if (this._sortedIds.length === 0) return;
		const lastIndex = this._sortedIds.length - 1;
		const oldestId = this._sortedIds[lastIndex];
		if (!oldestId) return;
		this._memories.delete(oldestId);
		this._sortedIds.splice(lastIndex, 1);
	}
}

export function calculateContextBudget(
	maxContextTokens: number,
	systemPromptTokens: number,
	maxMemoryTokens?: number,
	options?: ContextBudgetOptions
): { memoryBudget: number; conversationBudget: number } {
	const memoryPercent = options?.memoryBudgetPercent ?? 0.2;
	const availableForContent = maxContextTokens - systemPromptTokens - 1000;

	if (availableForContent <= 0) {
		return { memoryBudget: 0, conversationBudget: 0 };
	}

	if (maxMemoryTokens !== undefined) {
		const memoryBudget = Math.min(maxMemoryTokens, Math.floor(availableForContent * memoryPercent));
		return {
			memoryBudget,
			conversationBudget: availableForContent - memoryBudget,
		};
	}

	const memoryBudget = Math.floor(availableForContent * memoryPercent);
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
	conversationBudget: number
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

	const memoryContext = includedMemories.length > 0 ? `## Relevant Memories\n${includedMemories.join("\n")}` : "";

	const context: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }];

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
		includedMessages.length < conversationMessages.length || includedMemories.length < memories.length;

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
