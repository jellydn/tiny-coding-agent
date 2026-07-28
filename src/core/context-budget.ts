/**
 * Context budgeting — extracted from Agent.runStream() to make the 3-branch
 * context preparation decision tree independently testable.
 *
 * The three branches are:
 * 1. No maxContextTokens — just count tokens, no truncation
 * 2. maxContextTokens + memoryStore — calculate budget, retrieve memories,
 *    build context with memory
 * 3. maxContextTokens without memoryStore — truncate messages to fit
 *
 * `prepareContext()` handles all three branches and returns the prepared
 * messages + stats. The optional `wrapRetrieval` hook lets the caller
 * (Agent.runStream) wrap the memory retrieval with an observability span
 * without coupling this module to the observability layer.
 *
 * `buildContextStats()` replaces the `updateStats` closure in runStream() —
 * it recomputes ContextStats from the current message list after tool
 * results are appended during the iteration loop.
 */

import type { Message } from "../providers/types.js";
import type { ContextStats, Memory, MemoryStore } from "./memory.js";
import { countTokensSync, truncateMessages } from "./tokens.js";

/** Options for prepareContext — the context budgeting decision tree. */
export interface PrepareContextOptions {
	systemPrompt: string;
	userPrompt: string;
	messages: Message[];
	maxContextTokens?: number;
	memoryStore?: MemoryStore;
	maxMemoryTokens?: number;
	memoryBudgetPercent?: number;
	/** Optional retrieval wrapper. Called before memory retrieval starts.
	 *  Returns a function to call when retrieval ends:
	 *  - On success: `(resultCount)` — the caller logs/records the span.
	 *  - On failure: `(resultCount, error)` — the caller may throw to
	 *    propagate the error (matching AgentObservability.recordRetrievalError).
	 *  When omitted, retrieval errors propagate directly. */
	wrapRetrieval?: () => (resultCount: number, error?: unknown) => void;
}

/** Result of prepareContext. */
export interface PrepareContextResult {
	messages: Message[];
	stats: ContextStats;
	memoryTokensUsed: number;
	truncationApplied: boolean;
	systemTokens: number;
}

/** Params for buildContextStats — used to recompute stats during the loop. */
export interface BuildContextStatsParams {
	systemTokens: number;
	memoryTokens: number;
	messages: Message[];
	truncationApplied: boolean;
	maxContextTokens: number;
}

/** Options for calculateContextBudget. */
export interface ContextBudgetOptions {
	memoryBudgetPercent?: number;
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

/**
 * Prepare the context for an LLM call — the 3-branch decision tree extracted
 * from Agent.runStream().
 *
 * Returns the (possibly truncated) messages, context stats, and tracking
 * info for the iteration loop.
 */
export async function prepareContext(options: PrepareContextOptions): Promise<PrepareContextResult> {
	const systemTokens = countTokensSync(options.systemPrompt);
	const maxContextTokens = options.maxContextTokens ?? 0;

	// Branch 1: no context limit — just count, no truncation
	if (!options.maxContextTokens) {
		return {
			messages: options.messages,
			stats: buildContextStats({
				systemTokens,
				memoryTokens: 0,
				messages: options.messages,
				truncationApplied: false,
				maxContextTokens,
			}),
			memoryTokensUsed: 0,
			truncationApplied: false,
			systemTokens,
		};
	}

	// Branch 2: context limit + memory store — budget, retrieve, build
	if (options.memoryStore) {
		const { memoryBudget, conversationBudget } = calculateContextBudget(
			options.maxContextTokens,
			systemTokens,
			options.maxMemoryTokens,
			{ memoryBudgetPercent: options.memoryBudgetPercent }
		);

		const endRetrieval = options.wrapRetrieval?.();
		let relevantMemories: Memory[] = [];
		let result: { context: Array<{ role: string; content: string }>; stats: ContextStats };

		try {
			relevantMemories = options.memoryStore.findRelevant(options.userPrompt, 10);
			result = buildContextWithMemory(
				options.systemPrompt,
				relevantMemories,
				options.messages,
				memoryBudget,
				conversationBudget
			);
			endRetrieval?.(relevantMemories.length);
		} catch (err) {
			endRetrieval?.(relevantMemories.length, err);
			throw err;
		}

		return {
			messages: result.context as Message[],
			stats: result.stats,
			memoryTokensUsed: result.stats.memoryTokens,
			truncationApplied: result.stats.truncationApplied,
			systemTokens,
		};
	}

	// Branch 3: context limit, no memory — truncate to fit
	let messages = options.messages;
	let truncationApplied = false;
	const availableTokens = options.maxContextTokens - systemTokens - 1000;
	if (availableTokens > 0) {
		const truncated = await truncateMessages(messages, availableTokens);
		truncationApplied = truncated.length < messages.length;
		if (truncationApplied) messages = truncated as Message[];
	}
	return {
		messages,
		stats: buildContextStats({
			systemTokens,
			memoryTokens: 0,
			messages,
			truncationApplied,
			maxContextTokens,
		}),
		memoryTokensUsed: 0,
		truncationApplied,
		systemTokens,
	};
}
