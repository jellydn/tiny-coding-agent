/**
 * TurnExecutor — owns the per-iteration tool execution + error recovery logic
 * extracted from Agent.runStream().
 *
 * Given a batch of tool calls from the LLM response, this module:
 * 1. Executes them via the ToolRegistry
 * 2. Builds the ToolExecution display objects (running → complete/error)
 * 3. Appends tool result messages to the conversation
 * 4. Detects not-found errors, declined confirmations, and tool-call loops
 * 5. Returns a structured TurnResult so runStream() can decide what to do next
 *
 * This makes the tool dispatch + recovery path independently testable with a
 * mock ToolRegistry — no LLM client, no streaming, no observability setup needed.
 */

import type { ToolRegistry } from "../tools/registry.js";
import { isLooping, truncateOutput } from "./agent-utils.js";

/** A tool call received from the LLM response. */
export interface AssistantToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/** The result of executing one tool call. */
export interface ToolResultEntry {
	success: boolean;
	output?: string;
	error?: string;
}

/** Display object for the UI — mirrors AgentStreamChunk.toolExecutions. */
export interface ToolExecutionDisplay {
	name: string;
	status: "running" | "complete" | "error";
	args?: Record<string, unknown>;
	output?: string;
	error?: string;
	duration?: number;
	startTime?: number;
}

/**
 * The outcome of a single turn's tool execution.
 *
 * - `messages` — the tool result messages to append to the conversation
 * - `toolExecutions` — display objects for the UI (complete/error state)
 * - `loopBreakReason` — if set, runStream() should break the iteration loop
 *   and request a final answer from the LLM
 * - `shouldContinue` — if true, runStream() should continue to the next
 *   iteration without breaking (e.g. some tools declined but others succeeded)
 */
export interface TurnResult {
	toolResultMessages: Array<{ role: "tool"; content: string; toolCallId?: string }>;
	systemMessages: Array<{ role: "system"; content: string }>;
	toolExecutions: ToolExecutionDisplay[];
	loopBreakReason: "not_found" | "all_declined" | "loop_detected" | null;
	shouldContinue: boolean;
}

export interface TurnExecutorOptions {
	verbose?: boolean;
}

export class TurnExecutor {
	private _registry: ToolRegistry;
	private _verbose: boolean;
	private _recentToolCalls: string[] = [];

	constructor(registry: ToolRegistry, options: TurnExecutorOptions = {}) {
		this._registry = registry;
		this._verbose = options.verbose ?? false;
	}

	/** Reset the tool-call history (call at the start of a new runStream). */
	reset(): void {
		this._recentToolCalls = [];
	}

	/**
	 * Execute a batch of tool calls and return the structured result.
	 *
	 * This is the core method extracted from runStream(). It handles:
	 * - executeBatch via the registry
	 * - building display objects (running → complete/error)
	 * - appending tool result messages
	 * - not-found error detection (break loop)
	 * - declined confirmation handling (break if all, continue if some)
	 * - loop detection via isLooping()
	 */
	async executeTurn(toolCalls: AssistantToolCall[]): Promise<TurnResult> {
		const toolTimerStart = Date.now();

		// Execute the batch
		const calls = toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments }));
		const batchResults = await this._registry.executeBatch(calls);
		const toolDuration = Date.now() - toolTimerStart;

		// Map results back to tool calls
		const resultMap = new Map(batchResults.map((br) => [br.name, br]));
		const getToolResult = (name: string) => resultMap.get(name)?.result;

		const toolExecutionResults = toolCalls.map((tc) => ({
			toolCall: tc,
			result: getToolResult(tc.name) ?? {
				success: false,
				error: `Tool "${tc.name}" result not found`,
			},
		}));

		// Build display objects (complete/error state)
		const toolExecutions: ToolExecutionDisplay[] = toolExecutionResults.map(({ toolCall, result }) => ({
			name: toolCall.name,
			status: result.success ? "complete" : "error",
			args: toolCall.arguments,
			output: result.success ? truncateOutput(result.output) : undefined,
			error: result.error ? truncateOutput(result.error) : undefined,
			duration: toolDuration,
		}));

		// Build tool result messages for the conversation
		const toolResultMessages = toolExecutionResults.map(({ toolCall, result }) => ({
			role: "tool" as const,
			content: result.error || result.output || "(no output)",
			toolCallId: toolCall.id,
		}));

		// Track tool calls for loop detection
		for (const { toolCall } of toolExecutionResults) {
			const toolCallSignature = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
			this._recentToolCalls.push(toolCallSignature);
		}

		// --- Error recovery: not-found errors ---
		const notFoundErrors = toolExecutionResults.filter(
			({ result }) => !result.success && result.error?.includes("not found")
		);
		if (notFoundErrors.length > 0) {
			const missingTools = notFoundErrors.map(({ toolCall }) => toolCall.name).join(", ");
			if (this._verbose) {
				console.log(`\n[WARNING] Tool(s) not found: ${missingTools}, breaking loop`);
			}
			return {
				toolResultMessages,
				systemMessages: [
					{
						role: "system",
						content: `ERROR: The following tool(s) are not available: ${missingTools}. Please stop and provide your final answer based on the information you have gathered, or ask the user for alternative approaches.`,
					},
				],
				toolExecutions,
				loopBreakReason: "not_found",
				shouldContinue: false,
			};
		}

		// --- Error recovery: declined confirmations ---
		const declinedErrors = toolExecutionResults.filter(
			({ result }) => !result.success && result.error?.includes("User declined confirmation")
		);
		if (declinedErrors.length > 0) {
			const declinedTools = declinedErrors.map(({ toolCall }) => toolCall.name).join(", ");

			if (declinedErrors.length === toolExecutionResults.length) {
				// All tools declined — request final answer
				if (this._verbose) {
					console.log(`\n[INFO] All tools declined: ${declinedTools}, requesting final answer`);
				}
				return {
					toolResultMessages,
					systemMessages: [
						{
							role: "system",
							content: `All tool calls (${declinedTools}) were declined by the user. Provide your final answer now without making any more tool calls.`,
						},
					],
					toolExecutions,
					loopBreakReason: "all_declined",
					shouldContinue: false,
				};
			}

			// Some tools declined — continue with the remaining ones
			if (this._verbose) {
				console.log(`\n[INFO] User declined confirmation: ${declinedTools}, continuing with remaining tools`);
			}
			return {
				toolResultMessages,
				systemMessages: [],
				toolExecutions,
				loopBreakReason: null,
				shouldContinue: true,
			};
		}

		// --- Loop detection ---
		if (this._recentToolCalls.length >= 3 && isLooping(this._recentToolCalls)) {
			const toolName = toolCalls[0]?.name ?? "unknown";
			if (this._verbose) {
				console.log(`\n[WARNING] Detected tool call loop for ${toolName}, breaking loop`);
			}
			return {
				toolResultMessages,
				systemMessages: [
					{
						role: "system",
						content: `STOP: You have called ${toolName} repeatedly with the same arguments. Please stop and use the results you already have, or try a different approach. Provide your final answer now based on the information you have gathered.`,
					},
				],
				toolExecutions,
				loopBreakReason: "loop_detected",
				shouldContinue: false,
			};
		}

		// Normal case — all tools executed, continue to next iteration
		return {
			toolResultMessages,
			systemMessages: [],
			toolExecutions,
			loopBreakReason: null,
			shouldContinue: true,
		};
	}

	/** Build the "running" display objects for the UI before execution starts. */
	static runningDisplay(toolCalls: AssistantToolCall[]): ToolExecutionDisplay[] {
		return toolCalls.map((tc) => ({
			name: tc.name,
			status: "running" as const,
			args: tc.arguments,
			startTime: Date.now(),
		}));
	}
}
