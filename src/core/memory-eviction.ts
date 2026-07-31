import { countTokensSync } from "./tokens.js";

/**
 * Memory domain types and eviction strategy utilities.
 *
 * Extracted from memory.ts to separate pure domain types and eviction
 * logic from the MemoryStore persistence and lifecycle management.
 */

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

/**
 * Category weight multipliers for relevance scoring.
 * Higher values boost memories in that category during findRelevant().
 */
export const CATEGORY_MULTIPLIERS: Record<MemoryCategory, number> = {
	project: 1.5,
	codebase: 1.2,
	user: 1,
};

/**
 * Get the relevance multiplier for a given memory category.
 */
export function getCategoryMultiplier(category: MemoryCategory): number {
	return CATEGORY_MULTIPLIERS[category] ?? 1;
}

/**
 * Generate a unique memory ID.
 */
export function generateMemoryId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Count total tokens across all memories.
 */
export function countMemoryTokens(memories: Map<string, Memory>): number {
	return Array.from(memories.values()).reduce(
		(total, m) => total + countTokensSync(m.content) + countTokensSync(m.category),
		0
	);
}

/**
 * Check whether eviction should be triggered based on count and token limits.
 */
export function shouldEvict(
	memoryCount: number,
	maxMemories: number,
	tokenCount: number,
	maxMemoryTokens: number | undefined
): boolean {
	const countLimitExceeded = memoryCount > maxMemories;
	const tokenLimitExceeded = maxMemoryTokens !== undefined && tokenCount > maxMemoryTokens;
	return countLimitExceeded || tokenLimitExceeded;
}

/**
 * Evict the oldest memory (last in the sorted-by-access-time array).
 * Returns the ID of the evicted memory, or undefined if nothing was evicted.
 */
export function evictOldest(memories: Map<string, Memory>, sortedIds: string[]): string | undefined {
	if (sortedIds.length === 0) return undefined;
	const lastIndex = sortedIds.length - 1;
	const oldestId = sortedIds[lastIndex];
	if (!oldestId) return undefined;
	memories.delete(oldestId);
	sortedIds.splice(lastIndex, 1);
	return oldestId;
}
