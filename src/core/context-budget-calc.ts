import type { Message } from "../providers/types.js";
import type { ContextStats, Memory } from "./memory.js";
import { countTokensSync } from "./tokens.js";

/**
 * Context budget calculation utilities extracted from context-budget.ts.
 *
 * Deepening rationale (architecture review Candidate #3):
 * - calculateMessageTokens, buildContextStats, calculateContextBudget are pure
 *   calculation functions that don't depend on the prepareContext orchestration
 * - Extracting them makes them independently testable and reusable
 * - Reduces context-budget.ts from ~200 lines to ~130 lines
 */

/** Options for calculateContextBudget. */
export interface ContextBudgetOptions {
	memoryBudgetPercent?: number;
}

/** Params for buildContextStats — used to recompute stats during the loop. */
export interface BuildContextStatsParams {
	systemTokens: number;
	memoryTokens: number;
	messages: Message[];
	truncationApplied: boolean;
	maxContextTokens: number;
}

/** Count the total tokens across all messages (sync, character-based). */
export function calculateMessageTokens(messages: Message[]): number {
	return messages.reduce((sum, msg) => sum + countTokensSync(msg.content), 0);
}

/** Build a ContextStats object from the current state — replaces the
 *  `updateStats` closure in runStream(). */
export function buildContextStats(params: BuildContextStatsParams): ContextStats {
	const convTokens = calculateMessageTokens(params.messages);
	return {
		systemPromptTokens: params.systemTokens,
		memoryTokens: params.memoryTokens,
		conversationTokens: convTokens,
		totalTokens: params.systemTokens + params.memoryTokens + convTokens,
		maxContextTokens: params.maxContextTokens,
		truncationApplied: params.truncationApplied,
		memoryCount: 0,
	};
}

/**
 * Calculate the memory and conversation budgets from the total context
 * token limit, system prompt tokens, and optional max memory tokens.
 *
 * Extracted from memory.ts to give context budgeting a single home —
 * context-budget.ts. The Memory type is imported type-only from memory.ts,
 * so there is no runtime cycle.
 */
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

/**
 * Build the context array (system prompt + memories + conversation messages)
 * with token-budgeted inclusion of memories and conversation history.
 *
 * Extracted from memory.ts — operates on Memory[] and ContextStats, both
 * imported type-only from memory.ts (no runtime cycle).
 */
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
