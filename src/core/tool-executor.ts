/**
 * tool-executor.ts — tool execution loop for tiny-agent's agent loop.
 *
 * Extracted from agent.ts runStream() (Round 8 Candidate #1) so tool
 * dispatch, result processing, and loop-break logic are independently
 * testable and agent.ts focuses on the LLM streaming loop.
 */

import type { Message } from "../providers/types.js";
import { RunnerObservability } from "./runner-observability.js";
import { TurnExecutor, type TurnResult } from "./turn-executor.js";

export interface ToolCallInfo {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ExecuteToolCallsResult {
	toolResultMessages: Message[];
	systemMessages: Message[];
	loopBreakReason: "not_found" | "all_declined" | "loop_detected" | null;
	toolExecutions: Array<{
		name: string;
		status: "running" | "complete" | "error";
		args?: Record<string, unknown>;
		output?: string;
		error?: string;
		summary?: string;
	}>;
}

/**
 * Execute a batch of tool calls, record observability, and return results.
 *
 * This encapsulates the tool execution block from agent.ts runStream():
 * - Begin tool execution span
 * - Yield "running" display objects
 * - Execute turn via TurnExecutor
 * - Record tool execution in observability
 * - Yield "complete/error" display objects
 * - Append tool result messages
 * - Handle loop break reasons
 */
export async function executeToolCalls(
	assistantToolCalls: ToolCallInfo[],
	turnExecutor: TurnExecutor,
	runnerObs: RunnerObservability,
): Promise<ExecuteToolCallsResult> {
	const { span: toolSpan, timer: toolTimer } = runnerObs.beginToolExecution();

	const turnResult: TurnResult = await turnExecutor.executeTurn(assistantToolCalls);
	const toolDuration = Math.round(toolTimer.ms);

	runnerObs.recordToolExecution(
		toolSpan,
		toolTimer,
		assistantToolCalls.map((tc) => tc.name),
		turnResult.toolExecutions.map((exec) => ({
			name: exec.name,
			status: (exec.status === "complete" ? "complete" : "error") as "complete" | "error",
			latencyMs: toolDuration,
			error: exec.error,
		}))
	);

	return {
		toolResultMessages: turnResult.toolResultMessages,
		systemMessages: turnResult.systemMessages,
		loopBreakReason: turnResult.loopBreakReason,
		toolExecutions: turnResult.toolExecutions.map((te) => ({
			...te,
			duration: toolDuration,
		})),
	};
}
