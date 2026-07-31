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
 * Calculation functions (calculateMessageTokens, buildContextStats,
 * calculateContextBudget, buildContextWithMemory) have been extracted
 * to context-budget-calc.ts for independent testability and reuse.
 */

import type { Message } from "../providers/types.js";
import { buildContextStats, buildContextWithMemory, calculateContextBudget } from "./context-budget-calc.js";
import type { Memory, MemoryStore } from "./memory.js";

export type { BuildContextStatsParams, ContextBudgetOptions } from "./context-budget-calc.js";
export {
	buildContextStats,
	buildContextWithMemory,
	calculateContextBudget,
	calculateMessageTokens,
} from "./context-budget-calc.js";

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
	stats: import("./memory.js").ContextStats;
	memoryTokensUsed: number;
	truncationApplied: boolean;
	systemTokens: number;
}

/**
 * Prepare the context for an LLM call — the 3-branch decision tree extracted
 * from Agent.runStream().
 *
 * Returns the (possibly truncated) messages, context stats, and tracking
 * info for the iteration loop.
 */
export async function prepareContext(options: PrepareContextOptions): Promise<PrepareContextResult> {
	const { countTokensSync: countTokens } = await import("./tokens.js");
	const systemTokens = countTokens(options.systemPrompt);
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
		let result: { context: Array<{ role: string; content: string }>; stats: import("./memory.js").ContextStats };

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
		const { truncateMessages: truncate } = await import("./tokens.js");
		const truncated = await truncate(messages, availableTokens);
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
