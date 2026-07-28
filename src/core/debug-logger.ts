import type { ProviderConfig, ThinkingConfig } from "../config/schema.js";
import type { ContextStats } from "./memory.js";

/**
 * Parameters for {@link DebugLogger.logRequestDetails}.
 */
export interface RequestDetailsParams {
	providerType: string;
	model: string;
	providerConfig?: ProviderConfig;
	thinking?: ThinkingConfig;
	systemPromptLength: number;
	messageCount: number;
	toolCount: number;
	maxContextTokens?: number;
	memoryCount?: number;
}

/**
 * Encapsulates the six verbose-logging blocks that were previously scattered
 * throughout `Agent.runStream()` as `if (this._verbose) { console.log(...) }`.
 *
 * When `verbose` is false (the default), every method is a no-op — zero
 * overhead, no conditional branches in the caller.
 *
 * The class has its own `redactKey` helper to avoid a circular import with
 * `agent.ts` (which exports `redactApiKey` for tests). The logic is identical.
 */
export class DebugLogger {
	constructor(private readonly _verbose: boolean) {}

	/**
	 * Log request configuration details at the start of a run.
	 * Replaces the first `if (this._verbose)` block in `runStream()`.
	 */
	logRequestDetails(params: RequestDetailsParams): void {
		if (!this._verbose) return;

		console.log("\n=== Request Details ===");
		console.log(`Provider: ${params.providerType}`);
		console.log(`Model: ${params.model}`);
		if (params.providerConfig) {
			const config = params.providerConfig;
			console.log(`Provider config: baseUrl=${config.baseUrl ?? "(default)"}, apiKey=${redactKey(config.apiKey)}`);
		}
		if (params.thinking) {
			console.log(
				`Thinking config: enabled=${params.thinking.enabled ?? false}, effort=${params.thinking.effort ?? "medium"}`
			);
		}
		console.log(`System prompt length: ${params.systemPromptLength}`);
		console.log(`Messages: ${params.messageCount}`);
		console.log(`Tools: ${params.toolCount}`);
		console.log(`Max context tokens: ${params.maxContextTokens ?? "(unlimited)"}`);
		console.log(`Memory entries: ${params.memoryCount ?? 0}`);
		console.log("========================\n");
	}

	/**
	 * Log an iteration header with context stats.
	 * Replaces the second `if (this._verbose)` block in `runStream()`.
	 */
	logIteration(iteration: number, contextStats: ContextStats, trackContextUsage: boolean): void {
		if (!this._verbose) return;

		console.log(`\n--- Iteration ${iteration + 1} ---`);
		if (trackContextUsage) {
			console.log(
				`Context: ${contextStats.totalTokens}/${contextStats.maxContextTokens} tokens ` +
					`(system=${contextStats.systemPromptTokens}, memory=${contextStats.memoryTokens}, conversation=${contextStats.conversationTokens})`
			);
			if (contextStats.truncationApplied) {
				console.log("  ⚠ Truncation applied");
			}
		}
	}

	/**
	 * Log the LLM response and any tool calls it produced.
	 * Replaces the third `if (this._verbose)` block in `runStream()`.
	 */
	logLlmResponse(fullContent: string, responseToolCalls: string[]): void {
		if (!this._verbose) return;

		console.log(`\n[LLM Response] (${fullContent.length} chars)`);
		if (responseToolCalls.length > 0) {
			console.log(`Tool calls: ${responseToolCalls.join(", ")}`);
		}
	}

	/**
	 * Log that the agent finished after producing a final answer.
	 * Replaces the fourth `if (this._verbose)` block in `runStream()`.
	 */
	logAgentFinished(iterations: number): void {
		if (!this._verbose) return;

		console.log(`\n✓ Agent finished after ${iterations} iteration(s)`);
	}

	/**
	 * Log that loop detection triggered a break.
	 * Replaces the fifth `if (this._verbose)` block in `runStream()`.
	 */
	logLoopDetected(): void {
		if (!this._verbose) return;

		console.log("\n⚠ Loop detected — breaking out of iteration loop");
	}

	/**
	 * Log that the max iteration limit was reached.
	 * Replaces the sixth `if (this._verbose)` block in `runStream()`.
	 */
	logMaxIterations(maxIterations: number): void {
		if (!this._verbose) return;

		console.log(`\n⚠ Max iterations (${maxIterations}) reached without a final answer`);
	}
}

/**
 * Redact an API key for safe logging.
 * Duplicate of `redactApiKey` in `agent.ts` — kept here to avoid a
 * circular import (agent.ts imports DebugLogger, DebugLogger must not
 * import from agent.ts at runtime).
 */
function redactKey(key?: string): string {
	if (!key) return "(not set)";
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...REDACTED`;
}
