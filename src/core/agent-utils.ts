/**
 * Agent utility functions — pure helpers extracted from agent.ts to break
 * the circular dependency between agent.ts and turn-executor.ts.
 *
 * `isLooping` and `truncateOutput` are used by both Agent.runStream() and
 * TurnExecutor.executeTurn(). Moving them here lets turn-executor.ts import
 * from this file instead of from agent.ts, breaking the cycle.
 *
 * `streamLlmResponse` eliminates the duplicate stream-creation + iteration
 * pattern between the main loop and the loop-detection final-answer section
 * in runStream() (architecture review Candidate #2).
 */

import type { ChatOptions, LLMClient, Message, TokenUsage, ToolCall, ToolDefinition } from "../providers/types.js";

const MAX_OUTPUT_LENGTH = 500;

// Loop detection thresholds
export const LOOP_DETECTION = {
	MIN_RECENT_CALLS: 3,
	IDENTICAL_REPEAT: 3,
	SAME_TOOL_THRESHOLD: 5,
	DOMINANT_TOOL_THRESHOLD: 8,
	LOOKBACK_WINDOW: 10,
} as const;

export function isLooping(recentToolCalls: string[]): boolean {
	if (recentToolCalls.length < LOOP_DETECTION.MIN_RECENT_CALLS) return false;

	const extractTool = (call: string): string => call.match(/^([^:]+):/)?.[1] ?? "";
	const lastCall = recentToolCalls[recentToolCalls.length - 1] ?? "";
	const lastTool = extractTool(lastCall);

	if (recentToolCalls.slice(-LOOP_DETECTION.IDENTICAL_REPEAT).every((c) => c === lastCall)) return true;

	if (recentToolCalls.length >= LOOP_DETECTION.SAME_TOOL_THRESHOLD) {
		const lastFive = recentToolCalls.slice(-LOOP_DETECTION.SAME_TOOL_THRESHOLD);
		if (lastFive.every((c) => extractTool(c) === lastTool)) return true;
	}

	if (recentToolCalls.length >= LOOP_DETECTION.LOOKBACK_WINDOW) {
		const counts: Record<string, number> = {};
		for (const call of recentToolCalls.slice(-LOOP_DETECTION.LOOKBACK_WINDOW)) {
			const tool = extractTool(call);
			counts[tool] = (counts[tool] ?? 0) + 1;
		}
		if (Math.max(...Object.values(counts), 0) >= LOOP_DETECTION.DOMINANT_TOOL_THRESHOLD) return true;
	}

	return false;
}

export function truncateOutput(output: string | undefined): string | undefined {
	if (!output) return output;
	const lines = output.split("\n");
	if (lines.length > 10) {
		return `${lines.slice(0, 10).join("\n")}\n... (${lines.length - 10} more lines)`;
	}
	if (output.length > MAX_OUTPUT_LENGTH) {
		return `${output.slice(0, MAX_OUTPUT_LENGTH)}\n... (${output.length - MAX_OUTPUT_LENGTH} more chars)`;
	}
	return output;
}

// ─── streamLlmResponse ───────────────────────────────────────────────

/** Options for streamLlmResponse — mirrors the subset of ChatOptions needed
 *  to create an LLM stream, plus the system prompt to prepend. */
export interface StreamLlmOptions {
	llmClient: LLMClient;
	model: string;
	systemPrompt: string;
	messages: Message[];
	tools?: ToolDefinition[];
	thinking?: ChatOptions["thinking"];
	signal?: AbortSignal;
}

/** Collected result after the stream completes — tool calls, usage, timing. */
export interface StreamLlmResult {
	toolCalls: ToolCall[];
	usage?: TokenUsage;
	timeToFirstTokenMs?: number;
}

/**
 * Create an LLM stream with the system prompt prepended, and iterate it.
 * Yields raw content strings for real-time display. Returns collected
 * tool calls, usage, and time-to-first-token via the generator's return value.
 *
 * Eliminates the duplicate stream-creation + iteration pattern between
 * the main loop and the loop-detection final-answer section in runStream().
 *
 * The caller is responsible for:
 * - Deciding what to yield (e.g. isValidToolCall filtering in the main loop)
 * - Building fullContent from yielded strings
 * - Error handling (AbortError rethrow, error yield + return)
 *
 * Usage:
 * ```ts
 * const gen = streamLlmResponse({ llmClient, model, systemPrompt, messages, tools });
 * while (true) {
 *   const { value, done } = await gen.next();
 *   if (done) { /* value is StreamLlmResult *\/ break; }
 *   // value is a content string — yield or filter as needed
 * }
 * ```
 */
// ─── streamFinalAnswer ───────────────────────────────────────────────

/** Options for streamFinalAnswer — a subset of StreamLlmOptions without tools
 *  (the final-answer stream never includes tool calls). */
export interface StreamFinalAnswerOptions {
	llmClient: LLMClient;
	model: string;
	systemPrompt: string;
	messages: Message[];
	thinking?: ChatOptions["thinking"];
	signal?: AbortSignal;
}

/** Result of streamFinalAnswer — yielded content strings + any error. */
export interface StreamFinalAnswerResult {
	/** All content chunks yielded, concatenated. */
	content: string;
	/** If the stream threw a non-Abort error, it's captured here (not thrown). */
	error?: string;
	/** True if the error was an AbortError (caller should rethrow). */
	aborted?: boolean;
}

/**
 * Create an LLM stream and iterate it to completion, yielding content strings.
 * Unlike streamLlmResponse, this helper:
 * - Never passes tools (final-answer mode — no tool calls)
 * - Catches non-Abort errors and returns them in the result (does not throw)
 * - Re-throws AbortError (caller must handle)
 *
 * This eliminates the duplicate stream-iteration + catch pattern between
 * the main loop's error path and the loop-detection final-answer block
 * in runStream().
 *
 * The generator yields content strings for real-time display, then returns
 * a StreamFinalAnswerResult with the full content + any error.
 *
 * Usage:
 * ```ts
 * const gen = streamFinalAnswer({ llmClient, model, systemPrompt, messages });
 * while (true) {
 *   const { value, done } = await gen.next();
 *   if (done) {
 *     if (value.aborted) throw new DOMException("Aborted", "AbortError");
 *     if (value.error) { /* handle error *\/ }
 *     else { /* value.content is the full text *\/ }
 *     break;
 *   }
 *   // value is a content string — yield it to the UI
 * }
 * ```
 */
export async function* streamFinalAnswer(
	options: StreamFinalAnswerOptions
): AsyncGenerator<string, StreamFinalAnswerResult, unknown> {
	let fullContent = "";

	try {
		const streamGen = streamLlmResponse({
			llmClient: options.llmClient,
			model: options.model,
			systemPrompt: options.systemPrompt,
			messages: options.messages,
			thinking: options.thinking,
			signal: options.signal,
		});

		while (true) {
			const { value, done } = await streamGen.next();
			if (done) break;
			fullContent += value;
			yield value;
		}

		return { content: fullContent };
	} catch (err) {
		const streamError = err as Error | DOMException;
		if (streamError instanceof DOMException && streamError.name === "AbortError") {
			return { content: fullContent, aborted: true };
		}
		const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
		return { content: fullContent, error: errorMessage };
	}
}

// ─── streamLlmResponse ───────────────────────────────────────────────

export async function* streamLlmResponse(options: StreamLlmOptions): AsyncGenerator<string, StreamLlmResult, unknown> {
	const stream = options.llmClient.stream({
		model: options.model,
		messages: [{ role: "system", content: options.systemPrompt }, ...options.messages],
		tools: options.tools,
		thinking: options.thinking,
		signal: options.signal,
	});

	const toolCalls: ToolCall[] = [];
	let usage: TokenUsage | undefined;
	let timeToFirstTokenMs: number | undefined;
	const startTime = Date.now();
	let firstChunkSeen = false;

	for await (const chunk of stream) {
		if (!firstChunkSeen && (chunk.content || chunk.toolCalls)) {
			firstChunkSeen = true;
			timeToFirstTokenMs = Date.now() - startTime;
		}
		if (chunk.content) {
			yield chunk.content;
		}
		if (chunk.toolCalls) {
			toolCalls.push(...chunk.toolCalls);
		}
		if (chunk.usage) {
			usage = chunk.usage;
		}
	}

	return { toolCalls, usage, timeToFirstTokenMs };
}
