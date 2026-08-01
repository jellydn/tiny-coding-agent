/**
 * StreamProcessor — owns the main iteration loop extracted from Agent.runStream().
 *
 * This module handles:
 * 1. LLM streaming + chunk filtering
 * 2. Tool execution dispatch via TurnExecutor
 * 3. Loop detection + final answer generation
 * 4. Max iterations handling
 * 5. Observability recording
 *
 * The Agent class becomes a thin orchestrator that sets up context,
 * filters tools, and delegates the streaming loop to StreamProcessor.
 */

import type { ChatOptions, LLMClient, Message, TokenUsage, ToolDefinition } from "../providers/types.js";
import {
	checkAborted,
	isValidToolCall,
	type StreamFinalAnswerResult,
	type StreamLlmResult,
	streamFinalAnswer,
	streamLlmResponse,
} from "./agent-utils.js";
import type { DebugLogger } from "./debug-logger.js";
import type { ContextStats } from "./memory.js";
import type { RunnerObservability } from "./runner-observability.js";
import { executeToolCalls } from "./tool-executor.js";
import { type AssistantToolCall, TurnExecutor } from "./turn-executor.js";

/** Observability metadata for the final chunk. */
export interface StreamProcessorObservabilityMeta {
	traceId: string;
	latencyMs: number;
	usage?: TokenUsage;
	estimatedCostUsd: number;
}

/** Stream chunk yielded by StreamProcessor — mirrors AgentStreamChunk. */
export interface StreamChunk {
	content: string;
	iterations: number;
	done: boolean;
	toolCalls?: string[];
	toolExecutions?: Array<{
		name: string;
		status: "running" | "complete" | "error";
		args?: Record<string, unknown>;
		output?: string;
		error?: string;
		summary?: string;
		duration?: number;
		startTime?: number;
	}>;
	contextStats?: ContextStats;
	maxIterationsReached?: boolean;
	observability?: StreamProcessorObservabilityMeta;
}

/** Configuration for the stream processor. */
export interface StreamProcessorConfig {
	/** The LLM client to use for streaming. */
	llmClient: LLMClient;
	/** The model name (parsed, e.g. "claude-3-opus"). */
	model: string;
	/** The system prompt. */
	systemPrompt: string;
	/** The messages array (will be mutated during processing). */
	messages: Message[];
	/** Tool definitions to send to the LLM. */
	tools?: ToolDefinition[];
	/** Thinking configuration. */
	thinking?: ChatOptions["thinking"];
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
	/** Maximum iterations before forced stop. */
	maxIterations: number;
	/** Whether to track context usage. */
	trackContextUsage: boolean;
	/** Turn executor for tool dispatch. */
	turnExecutor: TurnExecutor;
	/** Runner observability wrapper. */
	runnerObs: RunnerObservability;
	/** Debug logger. */
	debug: DebugLogger;
	/** Function to update context stats. */
	updateStats: () => ContextStats;
	/** Callback to save conversation history. */
	onSaveHistory: (messages: Message[]) => Promise<void>;
	/** User prompt (for observability). */
	userPrompt: string;
}

/**
 * Result returned by StreamProcessor.process().
 * The async generator yields StreamChunks, and the generator's return
 * value provides the final content and iteration count.
 */
export interface StreamProcessorResult {
	content: string;
	iterations: number;
}

/**
 * StreamProcessor — the core iteration loop for the agent.
 *
 * Extracted from Agent.runStream() (Round 10 Candidate #1) to:
 * - Reduce agent.ts from ~640 to ~450 lines
 * - Make the iteration loop independently testable
 * - Separate LLM streaming concerns from context setup
 *
 * Usage:
 * ```ts
 * const processor = new StreamProcessor(config);
 * for await (const chunk of processor.process()) {
 *   // yield chunks to UI
 * }
 * // generator return value has final content + iterations
 * ```
 */
export class StreamProcessor {
	private _config: StreamProcessorConfig;

	constructor(config: StreamProcessorConfig) {
		this._config = config;
	}

	/**
	 * Run the main iteration loop, yielding StreamChunks.
	 *
	 * This is an async generator that:
	 * 1. Streams LLM responses and yields content chunks
	 * 2. Executes tool calls via TurnExecutor
	 * 3. Handles loop detection and final answer generation
	 * 4. Handles max iterations reached
	 * 5. Records observability metrics
	 *
	 * The generator yields StreamChunk objects for real-time display,
	 * and returns a StreamProcessorResult with the final content and
	 * iteration count.
	 */
	async *process(): AsyncGenerator<StreamChunk, StreamProcessorResult, unknown> {
		const {
			llmClient,
			model,
			systemPrompt,
			messages,
			tools,
			thinking,
			signal,
			maxIterations,
			trackContextUsage,
			turnExecutor,
			runnerObs,
			debug,
			updateStats,
			onSaveHistory,
			userPrompt,
		} = this._config;

		let iteration = 0;
		let loopDetected = false;
		let contextStats = updateStats();

		try {
			for (iteration = 0; iteration < maxIterations; iteration++) {
				checkAborted(signal);

				debug.logIteration(iteration, contextStats, trackContextUsage);

				const { span: llmSpan, timer: llmTimer } = runnerObs.beginLlmCall();
				let llmUsage: TokenUsage | undefined;
				let llmTimeToFirstToken: number | undefined;

				let fullContent = "";
				let responseToolCalls: string[] = [];
				const assistantToolCalls: AssistantToolCall[] = [];

				try {
					const streamGen = streamLlmResponse({
						llmClient,
						model,
						systemPrompt,
						messages,
						tools: tools && tools.length > 0 ? tools : undefined,
						thinking,
						signal,
					});

					// while(true) + gen.next() is required (not for-await) because we
					// need the generator's return value (StreamLlmResult) which
					// for-await does not expose.
					while (true) {
						const { value, done } = await streamGen.next();
						if (done) {
							const result = value as StreamLlmResult;
							assistantToolCalls.push(...result.toolCalls);
							responseToolCalls = result.toolCalls.map((tc) => tc.name);
							llmUsage = result.usage;
							llmTimeToFirstToken = result.timeToFirstTokenMs;
							break;
						}
						// value is a content string — filter tool-call JSON from display
						if (!isValidToolCall(value)) {
							fullContent += value;
							yield {
								content: value,
								iterations: iteration + 1,
								done: false,
								contextStats,
							};
						}
					}
				} catch (err) {
					runnerObs.recordLlmCallError(llmSpan, err);
					const streamError = err as Error | DOMException;
					if (streamError instanceof DOMException && streamError.name === "AbortError") {
						throw streamError;
					}
					const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
					runnerObs.markFailed();
					yield {
						content: `\n\nError during LLM stream: ${errorMessage}`,
						iterations: iteration + 1,
						done: true,
						contextStats,
						observability: runnerObs.buildMeta(),
					};
					return { content: fullContent, iterations: iteration + 1 };
				}

				const llmLatencyMs = Math.round(llmTimer.ms);

				runnerObs.recordLlmCall(
					llmSpan,
					llmTimer,
					{
						usage: llmUsage,
						content: fullContent,
						latencyMs: llmLatencyMs,
						timeToFirstTokenMs: llmTimeToFirstToken,
					},
					userPrompt
				);

				debug.logLlmResponse(fullContent, responseToolCalls);

				const assistantMessage: Message = {
					role: "assistant",
					content: fullContent,
				};

				messages.push(assistantMessage);

				if (assistantToolCalls.length > 0) {
					assistantMessage.toolCalls = assistantToolCalls;
				}

				if (assistantToolCalls.length === 0) {
					debug.logAgentFinished(iteration + 1);

					await onSaveHistory(messages);

					yield {
						content: "",
						iterations: iteration + 1,
						done: true,
						contextStats,
						observability: runnerObs.buildMeta(),
					};
					return { content: fullContent, iterations: iteration + 1 };
				}

				checkAborted(signal);

				// --- Tool execution via tool-executor --------------------------------
				yield {
					content: "",
					iterations: iteration + 1,
					done: false,
					toolExecutions: TurnExecutor.runningDisplay(assistantToolCalls),
					contextStats,
				};

				const toolResult = await executeToolCalls(assistantToolCalls, turnExecutor, runnerObs);

				yield {
					content: "",
					iterations: iteration + 1,
					done: false,
					toolExecutions: toolResult.toolExecutions,
					contextStats,
				};

				checkAborted(signal);

				// Append tool result messages to the conversation
				for (const msg of toolResult.toolResultMessages) {
					messages.push(msg);
				}

				// Append system messages (error recovery instructions)
				for (const msg of toolResult.systemMessages) {
					messages.push(msg);
				}

				// Handle loop break reasons
				if (toolResult.loopBreakReason) {
					loopDetected = true;
					break;
				}

				contextStats = updateStats();
			}

			if (loopDetected) {
				debug.logLoopDetected();

				// Use streamFinalAnswer to eliminate the duplicate stream-creation +
				// iteration + catch pattern. The helper yields content strings and
				// returns a StreamFinalAnswerResult with the full content or error.
				const finalGen = streamFinalAnswer({
					llmClient,
					model,
					systemPrompt,
					messages,
					thinking,
					signal,
				});

				let finalResult: StreamFinalAnswerResult = { content: "" };
				let finalContent = "";
				while (true) {
					const { value, done } = await finalGen.next();
					if (done) {
						finalResult = value;
						break;
					}
					finalContent += value;
					yield {
						content: value,
						iterations: iteration + 1,
						done: false,
						contextStats: updateStats(),
					};
				}

				if (finalResult.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}

				if (finalResult.error) {
					runnerObs.markFailed();
					yield {
						content: `\n\nError during LLM stream: ${finalResult.error}`,
						iterations: iteration + 1,
						done: true,
						contextStats: updateStats(),
						observability: runnerObs.buildMeta(),
					};
					return { content: finalContent, iterations: iteration + 1 };
				}

				await onSaveHistory(messages);
				yield {
					content: "",
					iterations: iteration + 1,
					done: true,
					contextStats: updateStats(),
					observability: runnerObs.buildMeta(),
				};
				return { content: finalContent, iterations: iteration + 1 };
			}

			debug.logMaxIterations(maxIterations);

			await onSaveHistory(messages);

			yield {
				content: "",
				iterations: iteration,
				done: true,
				maxIterationsReached: true,
				contextStats: updateStats(),
				observability: runnerObs.buildMeta(),
			};
			return { content: "", iterations: iteration };
		} catch (err) {
			runnerObs.requestError(err);
			throw err;
		} finally {
			runnerObs.finalize();
		}
	}
}
